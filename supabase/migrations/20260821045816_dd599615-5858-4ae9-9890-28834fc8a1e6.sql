-- ============================================================
-- 1) Concurrency-safe ambiguity checking via advisory locks
-- ============================================================

-- Any expense transaction insert takes the per-user/organization auto-link
-- domain lock, so candidate creation is serialized against auto-link
-- evaluation for that scope.
CREATE OR REPLACE FUNCTION public.serialize_expense_autolink_candidates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.transaction_type, 'expense') <> 'expense' OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'expense_autolink:' || NEW.user_id::text || ':' || COALESCE(NEW.organization_id::text, '-'),
      0
    )
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.serialize_expense_autolink_candidates() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.serialize_expense_autolink_candidates() FROM anon;
REVOKE EXECUTE ON FUNCTION public.serialize_expense_autolink_candidates() FROM authenticated;

DROP TRIGGER IF EXISTS transactions_serialize_expense_autolink ON public.transactions;
CREATE TRIGGER transactions_serialize_expense_autolink
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.serialize_expense_autolink_candidates();

CREATE OR REPLACE FUNCTION public.auto_link_expense_pair(
  _manual_tx_id uuid,
  _plaid_tx_id uuid,
  _confidence numeric DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_manual   public.transactions%ROWTYPE;
  v_plaid    public.transactions%ROWTYPE;
  v_caller   uuid := auth.uid();
  v_group_id uuid := gen_random_uuid();
  v_manual_amt numeric;
  v_plaid_amt  numeric;
  v_cand_count int;
  v_cand_id    uuid;
  v_scope_user uuid;
  v_scope_org  uuid;
BEGIN
  IF _manual_tx_id IS NULL OR _plaid_tx_id IS NULL OR _manual_tx_id = _plaid_tx_id THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'invalid_arguments');
  END IF;

  -- Scope + imported-row advisory locks are taken BEFORE any row locks and
  -- before the candidate scan, so candidate creation and auto-link evaluation
  -- for the same imported transaction are serialized.
  SELECT user_id, organization_id INTO v_scope_user, v_scope_org
    FROM public.transactions WHERE id = _plaid_tx_id;
  IF v_scope_user IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'missing_row');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'expense_autolink:' || v_scope_user::text || ':' || COALESCE(v_scope_org::text, '-'), 0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('expense_autolink_tx:' || _plaid_tx_id::text, 0)
  );

  IF _manual_tx_id < _plaid_tx_id THEN
    SELECT * INTO v_manual FROM public.transactions WHERE id = _manual_tx_id FOR UPDATE;
    SELECT * INTO v_plaid  FROM public.transactions WHERE id = _plaid_tx_id  FOR UPDATE;
  ELSE
    SELECT * INTO v_plaid  FROM public.transactions WHERE id = _plaid_tx_id  FOR UPDATE;
    SELECT * INTO v_manual FROM public.transactions WHERE id = _manual_tx_id FOR UPDATE;
  END IF;

  IF v_manual.id IS NULL OR v_plaid.id IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'missing_row');
  END IF;

  IF v_manual.user_id IS DISTINCT FROM v_plaid.user_id THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'user_mismatch');
  END IF;

  IF v_manual.organization_id IS DISTINCT FROM v_plaid.organization_id THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'organization_mismatch');
  END IF;

  IF v_caller IS NOT NULL AND v_caller IS DISTINCT FROM v_manual.user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_manual.transaction_type, 'expense') <> 'expense'
     OR COALESCE(v_plaid.transaction_type, 'expense') <> 'expense' THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'not_expense');
  END IF;

  IF COALESCE(v_manual.source_type, 'manual') <> 'manual' OR v_plaid.source_type <> 'plaid' THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'wrong_sides');
  END IF;

  IF COALESCE(v_manual.status, 'active') <> 'active' OR COALESCE(v_plaid.status, 'active') <> 'active'
     OR v_manual.match_status = 'linked' OR v_plaid.match_status = 'linked'
     OR v_manual.linked_group_id IS NOT NULL OR v_plaid.linked_group_id IS NOT NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'already_claimed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transaction_links
     WHERE status = 'linked'
       AND (manual_transaction_id IN (_manual_tx_id, _plaid_tx_id)
            OR plaid_transaction_record_id IN (_manual_tx_id, _plaid_tx_id))
  ) THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'already_linked');
  END IF;

  IF abs(v_plaid.transaction_date - v_manual.transaction_date) > 2 THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'date_out_of_range');
  END IF;

  v_manual_amt := abs(COALESCE(v_manual.amount, 0));
  v_plaid_amt  := abs(COALESCE(v_plaid.amount, 0));
  IF v_manual_amt = 0 THEN
    IF v_plaid_amt <> 0 THEN
      RETURN jsonb_build_object('linked', false, 'reason', 'amount_out_of_range');
    END IF;
  ELSIF abs(v_plaid_amt - v_manual_amt) / v_manual_amt > 0.01 + 1e-9 THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'amount_out_of_range');
  END IF;

  -- Ambiguity re-check, under both advisory locks and the row locks: the
  -- imported expense must have exactly one qualifying manual candidate in the
  -- same user + organization, and it must be the supplied one.
  SELECT count(*), min(m.id::text)::uuid
    INTO v_cand_count, v_cand_id
    FROM public.transactions m
   WHERE m.user_id = v_plaid.user_id
     AND m.organization_id IS NOT DISTINCT FROM v_plaid.organization_id
     AND m.id <> v_plaid.id
     AND COALESCE(m.transaction_type, 'expense') = 'expense'
     AND COALESCE(m.source_type, 'manual') = 'manual'
     AND COALESCE(m.status, 'active') = 'active'
     AND COALESCE(m.match_status, 'unmatched') <> 'linked'
     AND m.linked_group_id IS NULL
     AND abs(v_plaid.transaction_date - m.transaction_date) <= 2
     AND (
          (abs(COALESCE(m.amount, 0)) = 0 AND v_plaid_amt = 0)
          OR (abs(COALESCE(m.amount, 0)) > 0
              AND abs(v_plaid_amt - abs(COALESCE(m.amount, 0))) / abs(COALESCE(m.amount, 0)) <= 0.01 + 1e-9)
         );

  IF v_cand_count <> 1 OR v_cand_id IS DISTINCT FROM _manual_tx_id THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'ambiguous_candidates');
  END IF;

  BEGIN
    INSERT INTO public.transaction_links (
      user_id, organization_id, linked_group_id,
      manual_transaction_id, plaid_transaction_record_id,
      status, confidence_score, created_by_user, field_locks
    ) VALUES (
      v_manual.user_id, v_manual.organization_id, v_group_id,
      _manual_tx_id, _plaid_tx_id,
      'linked', _confidence, false, '{}'::jsonb
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'race_lost');
  END;

  UPDATE public.transactions
     SET match_status = 'linked',
         linked_group_id = v_group_id,
         source_type = 'merged',
         status = 'active',
         linked_plaid_transaction_id = _plaid_tx_id,
         linked_plaid_amount = v_plaid.amount,
         linked_plaid_posted_date = v_plaid.transaction_date,
         linked_plaid_account = v_plaid.account_source
   WHERE id = _manual_tx_id;

  UPDATE public.transactions
     SET status = 'merged',
         match_status = 'linked',
         linked_group_id = v_group_id
   WHERE id = _plaid_tx_id;

  RETURN jsonb_build_object('linked', true, 'linked_group_id', v_group_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) TO service_role;

-- Batch pass takes the same scope lock before scanning candidates.
CREATE OR REPLACE FUNCTION public.auto_link_expenses_for_user(_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := COALESCE(_user_id, auth.uid());
  v_rec  record;
  v_res  jsonb;
  v_org  record;
  v_linked int := 0;
  v_considered int := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('linked', 0, 'considered', 0, 'reason', 'no_user');
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  FOR v_org IN
    SELECT DISTINCT organization_id FROM public.transactions WHERE user_id = v_user
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'expense_autolink:' || v_user::text || ':' || COALESCE(v_org.organization_id::text, '-'), 0
      )
    );
  END LOOP;

  FOR v_rec IN
    WITH eligible AS (
      SELECT id, organization_id, transaction_date, abs(COALESCE(amount, 0)) AS amt,
             COALESCE(source_type, 'manual') AS src
        FROM public.transactions
       WHERE user_id = v_user
         AND COALESCE(transaction_type, 'expense') = 'expense'
         AND COALESCE(status, 'active') = 'active'
         AND COALESCE(match_status, 'unmatched') <> 'linked'
         AND linked_group_id IS NULL
    ),
    candidates AS (
      SELECT p.id AS plaid_id, m.id AS manual_id
        FROM eligible p
        JOIN eligible m
          ON m.src = 'manual'
         AND m.organization_id IS NOT DISTINCT FROM p.organization_id
         AND abs(p.transaction_date - m.transaction_date) <= 2
         AND (
              (m.amt = 0 AND p.amt = 0)
              OR (m.amt > 0 AND abs(p.amt - m.amt) / m.amt <= 0.01 + 1e-9)
             )
       WHERE p.src = 'plaid'
    ),
    single_manual AS (
      SELECT plaid_id, min(manual_id::text)::uuid AS manual_id
        FROM candidates
       GROUP BY plaid_id
      HAVING count(*) = 1
    )
    SELECT s.plaid_id, s.manual_id
      FROM single_manual s
     WHERE (SELECT count(*) FROM single_manual s2 WHERE s2.manual_id = s.manual_id) = 1
  LOOP
    v_considered := v_considered + 1;
    v_res := public.auto_link_expense_pair(v_rec.manual_id, v_rec.plaid_id, 100);
    IF COALESCE((v_res->>'linked')::boolean, false) THEN
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('linked', v_linked, 'considered', v_considered);
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_link_expenses_for_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_link_expenses_for_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.auto_link_expenses_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_link_expenses_for_user(uuid) TO service_role;

-- ============================================================
-- 2 + 3) Cluster-scoped cleanup with bookkeeping realignment
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_conflicting_transaction_links(_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := COALESCE(_user_id, auth.uid());
  v_superseded int := 0;
  v_realigned int := 0;
  v_repaired int := 0;
  v_ambiguous int := 0;
  v_clusters int := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('superseded', 0, 'realigned', 0, 'repaired', 0, 'ambiguous', 0,
                              'clusters', 0, 'reason', 'no_user');
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _claims (
    link_id uuid, linked_group_id uuid, tx uuid, at timestamptz
  ) ON COMMIT DROP;
  DELETE FROM _claims;

  INSERT INTO _claims
  SELECT id, linked_group_id, manual_transaction_id, COALESCE(linked_at, created_at)
    FROM public.transaction_links
   WHERE status = 'linked' AND user_id = v_user AND manual_transaction_id IS NOT NULL
  UNION ALL
  SELECT id, linked_group_id, plaid_transaction_record_id, COALESCE(linked_at, created_at)
    FROM public.transaction_links
   WHERE status = 'linked' AND user_id = v_user AND plaid_transaction_record_id IS NOT NULL;

  -- Groups drawn into a conflict (a transaction claimed by 2+ active groups).
  CREATE TEMP TABLE IF NOT EXISTS _involved (
    linked_group_id uuid, rows_in_group int, newest timestamptz
  ) ON COMMIT DROP;
  DELETE FROM _involved;

  INSERT INTO _involved
  SELECT c.linked_group_id, count(*), max(c.at)
    FROM _claims c
   WHERE c.tx IN (
     SELECT tx FROM _claims GROUP BY tx HAVING count(DISTINCT linked_group_id) > 1
   )
   GROUP BY c.linked_group_id;

  -- Connected components: groups joined by any shared transaction form one
  -- independent conflict cluster. Unrelated clusters never influence each other.
  CREATE TEMP TABLE IF NOT EXISTS _cluster (
    linked_group_id uuid, cluster_id uuid
  ) ON COMMIT DROP;
  DELETE FROM _cluster;

  INSERT INTO _cluster
  WITH RECURSIVE edges AS (
    SELECT DISTINCT a.linked_group_id AS g1, b.linked_group_id AS g2
      FROM _claims a
      JOIN _claims b ON a.tx = b.tx AND a.linked_group_id IS DISTINCT FROM b.linked_group_id
     WHERE a.linked_group_id IN (SELECT linked_group_id FROM _involved)
       AND b.linked_group_id IN (SELECT linked_group_id FROM _involved)
  ),
  reach(root, g) AS (
    SELECT linked_group_id, linked_group_id FROM _involved
    UNION
    SELECT r.root, e.g2 FROM reach r JOIN edges e ON e.g1 = r.g
  )
  SELECT g, min(root::text)::uuid FROM reach GROUP BY g;

  SELECT count(DISTINCT cluster_id) INTO v_clusters FROM _cluster;

  -- Split / many-to-many clusters stay for review: any group in the cluster
  -- holding more than one active relationship makes the cluster ambiguous.
  SELECT count(DISTINCT c.cluster_id) INTO v_ambiguous
    FROM _cluster c
    JOIN _involved i ON i.linked_group_id = c.linked_group_id
   WHERE i.rows_in_group > 1;

  -- One survivor per resolvable cluster (most recent claim wins), and only
  -- competing groups inside that same cluster are superseded.
  WITH resolvable AS (
    SELECT c.cluster_id
      FROM _cluster c
      JOIN _involved i ON i.linked_group_id = c.linked_group_id
     GROUP BY c.cluster_id
    HAVING max(i.rows_in_group) = 1
  ),
  ranked AS (
    SELECT c.cluster_id, c.linked_group_id, i.newest,
           row_number() OVER (
             PARTITION BY c.cluster_id
             ORDER BY i.newest DESC, c.linked_group_id::text DESC
           ) AS rn
      FROM _cluster c
      JOIN _involved i ON i.linked_group_id = c.linked_group_id
     WHERE c.cluster_id IN (SELECT cluster_id FROM resolvable)
  ),
  losers AS (
    SELECT linked_group_id FROM ranked WHERE rn > 1
  )
  UPDATE public.transaction_links l
     SET status = 'superseded'
   WHERE l.status = 'linked'
     AND l.linked_group_id IN (SELECT linked_group_id FROM losers);
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  -- Realign bookkeeping to the SURVIVING active group: a transaction that is
  -- still part of exactly one active group stays linked and points at it.
  WITH active AS (
    SELECT linked_group_id AS g, manual_transaction_id AS tx, false AS plaid_side
      FROM public.transaction_links
     WHERE status = 'linked' AND user_id = v_user AND manual_transaction_id IS NOT NULL
    UNION ALL
    SELECT linked_group_id, plaid_transaction_record_id, true
      FROM public.transaction_links
     WHERE status = 'linked' AND user_id = v_user AND plaid_transaction_record_id IS NOT NULL
  ),
  settled AS (
    SELECT tx, min(g::text)::uuid AS g, bool_or(plaid_side) AS plaid_side
      FROM active
     GROUP BY tx
    HAVING count(DISTINCT g) = 1
  )
  UPDATE public.transactions t
     SET linked_group_id = s.g,
         match_status = 'linked',
         status = CASE WHEN s.plaid_side THEN 'merged'
                       WHEN COALESCE(t.status, 'active') = 'merged' THEN 'active'
                       ELSE COALESCE(t.status, 'active') END
    FROM settled s
   WHERE t.id = s.tx
     AND t.user_id = v_user
     AND (t.linked_group_id IS DISTINCT FROM s.g
          OR COALESCE(t.match_status, 'unmatched') IS DISTINCT FROM 'linked'
          OR COALESCE(t.status, 'active') IS DISTINCT FROM
             (CASE WHEN s.plaid_side THEN 'merged' ELSE 'active' END));
  GET DIAGNOSTICS v_realigned = ROW_COUNT;

  -- No active relationship left → repair back to unmatched/active.
  UPDATE public.transactions t
     SET status = CASE WHEN t.status = 'merged' THEN 'active' ELSE t.status END,
         match_status = 'unmatched',
         linked_group_id = NULL,
         linked_plaid_transaction_id = NULL,
         linked_plaid_amount = NULL,
         linked_plaid_posted_date = NULL,
         linked_plaid_account = NULL,
         source_type = CASE WHEN t.source_type = 'merged' AND t.plaid_transaction_ref IS NULL
                            THEN 'manual' ELSE t.source_type END
   WHERE t.user_id = v_user
     AND (t.linked_group_id IS NOT NULL OR t.match_status = 'linked' OR t.status = 'merged')
     AND NOT EXISTS (
       SELECT 1 FROM public.transaction_links l
        WHERE l.status = 'linked'
          AND (l.manual_transaction_id = t.id OR l.plaid_transaction_record_id = t.id)
     );
  GET DIAGNOSTICS v_repaired = ROW_COUNT;

  RETURN jsonb_build_object('superseded', v_superseded, 'realigned', v_realigned,
                            'repaired', v_repaired, 'ambiguous', v_ambiguous,
                            'clusters', v_clusters);
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_conflicting_transaction_links(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_conflicting_transaction_links(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_conflicting_transaction_links(uuid) TO service_role;

-- ============================================================
-- 4) Safe, conflict-aware restoration + reconciliation
-- ============================================================
DO $do$
DECLARE
  r record;
  u uuid;
BEGIN
  FOR r IN
    SELECT l.id, l.linked_group_id, l.manual_transaction_id, l.plaid_transaction_record_id
      FROM public.transaction_links l
     WHERE l.status = 'superseded'
       AND EXISTS (
         SELECT 1 FROM public.transaction_links s
          WHERE s.linked_group_id = l.linked_group_id AND s.status = 'linked'
       )
     ORDER BY l.created_at
  LOOP
    -- Only restore when neither transaction is already active elsewhere.
    IF EXISTS (
      SELECT 1 FROM public.transaction_links o
       WHERE o.status = 'linked'
         AND o.linked_group_id IS DISTINCT FROM r.linked_group_id
         AND (
           (r.manual_transaction_id IS NOT NULL
             AND r.manual_transaction_id IN (o.manual_transaction_id, o.plaid_transaction_record_id))
           OR (r.plaid_transaction_record_id IS NOT NULL
             AND r.plaid_transaction_record_id IN (o.manual_transaction_id, o.plaid_transaction_record_id))
         )
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.transaction_links SET status = 'linked' WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      -- Leave superseded/reviewable.
      NULL;
    END;
  END LOOP;

  -- Reconciliation pass: the migration may not finish with a transaction
  -- active in two groups, or pointing at a superseded group.
  FOR u IN SELECT DISTINCT user_id FROM public.transaction_links WHERE user_id IS NOT NULL
  LOOP
    PERFORM public.cleanup_conflicting_transaction_links(u);
  END LOOP;
END
$do$;