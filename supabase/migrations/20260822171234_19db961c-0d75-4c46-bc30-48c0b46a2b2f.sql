-- Stale/orphaned link-group repair.
--
-- A link group is genuinely active only when it contains at least 2 DISTINCT
-- LIVE transactions (same rule as the frontend `computeLinkEligibility()`).
-- Groups that fail that test are stale leftovers (partner hard-deleted, merged
-- away, single-sided row) and must never block a new manual link.

CREATE OR REPLACE FUNCTION public.link_group_is_active(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (
    SELECT count(DISTINCT t.id)
      FROM public.transaction_links l
      JOIN public.transactions t
        ON t.id IN (l.manual_transaction_id, l.plaid_transaction_record_id)
     WHERE l.linked_group_id = _group_id
       AND l.status = 'linked'
  ) >= 2
$function$;

-- Supersede every active row of a stale group and reset the bookkeeping of the
-- transactions it referenced. Never touches groups that are genuinely active.
CREATE OR REPLACE FUNCTION public.repair_stale_link_group(_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx uuid[];
BEGIN
  IF _group_id IS NULL OR public.link_group_is_active(_group_id) THEN
    RETURN false;
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_tx
    FROM public.transaction_links l,
         LATERAL unnest(ARRAY[l.manual_transaction_id, l.plaid_transaction_record_id]) AS x
   WHERE l.linked_group_id = _group_id AND x IS NOT NULL;

  UPDATE public.transaction_links
     SET status = 'superseded', updated_at = now()
   WHERE linked_group_id = _group_id AND status = 'linked';

  UPDATE public.transactions t
     SET linked_group_id = NULL,
         match_status = 'unmatched',
         status = CASE WHEN t.status = 'merged' THEN 'active' ELSE t.status END,
         source_type = CASE WHEN t.source_type = 'merged' AND t.plaid_transaction_ref IS NULL
                            THEN 'manual' ELSE t.source_type END,
         linked_plaid_transaction_id = NULL,
         linked_plaid_amount = NULL,
         linked_plaid_posted_date = NULL,
         linked_plaid_account = NULL,
         updated_at = now()
   WHERE (t.linked_group_id = _group_id OR t.id = ANY(COALESCE(v_tx, ARRAY[]::uuid[])))
     AND NOT EXISTS (
       SELECT 1 FROM public.transaction_links l2
        WHERE l2.status = 'linked'
          AND l2.linked_group_id IS DISTINCT FROM _group_id
          AND (l2.manual_transaction_id = t.id OR l2.plaid_transaction_record_id = t.id)
     );

  RETURN true;
END;
$function$;

-- Frontend entry point: repair stale metadata for the selected transactions
-- right before a manual link attempt.
CREATE OR REPLACE FUNCTION public.repair_stale_links_for_transactions(_tx_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_repaired int := 0;
  v_cleared int := 0;
  g uuid;
BEGIN
  IF _tx_ids IS NULL OR array_length(_tx_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('groups_repaired', 0, 'transactions_cleared', 0);
  END IF;

  IF v_caller IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transactions WHERE id = ANY(_tx_ids) AND user_id IS DISTINCT FROM v_caller
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  FOR g IN
    SELECT DISTINCT l.linked_group_id
      FROM public.transaction_links l
     WHERE l.status = 'linked'
       AND (l.manual_transaction_id = ANY(_tx_ids) OR l.plaid_transaction_record_id = ANY(_tx_ids))
  LOOP
    IF public.repair_stale_link_group(g) THEN
      v_repaired := v_repaired + 1;
    END IF;
  END LOOP;

  -- Denormalized-only staleness: tx points at a group / claims to be linked but
  -- has no active link row at all.
  UPDATE public.transactions t
     SET linked_group_id = NULL,
         match_status = 'unmatched',
         status = CASE WHEN t.status = 'merged' THEN 'active' ELSE t.status END,
         updated_at = now()
   WHERE t.id = ANY(_tx_ids)
     AND (t.linked_group_id IS NOT NULL OR t.match_status = 'linked')
     AND NOT EXISTS (
       SELECT 1 FROM public.transaction_links l
        WHERE l.status = 'linked'
          AND (l.manual_transaction_id = t.id OR l.plaid_transaction_record_id = t.id)
     );
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RETURN jsonb_build_object('groups_repaired', v_repaired, 'transactions_cleared', v_cleared);
END;
$function$;

-- Trigger: self-heal stale conflicting groups before blocking a new link.
CREATE OR REPLACE FUNCTION public.enforce_single_active_link_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_other uuid;
BEGIN
  IF NEW.status <> 'linked' THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.transactions
   WHERE id IN (NEW.manual_transaction_id, NEW.plaid_transaction_record_id)
   FOR UPDATE;

  LOOP
    SELECT l.linked_group_id INTO v_other
      FROM public.transaction_links l
     WHERE l.status = 'linked'
       AND l.id IS DISTINCT FROM NEW.id
       AND l.linked_group_id IS DISTINCT FROM NEW.linked_group_id
       AND (
         (NEW.manual_transaction_id IS NOT NULL
           AND NEW.manual_transaction_id IN (l.manual_transaction_id, l.plaid_transaction_record_id))
         OR (NEW.plaid_transaction_record_id IS NOT NULL
           AND NEW.plaid_transaction_record_id IN (l.manual_transaction_id, l.plaid_transaction_record_id))
       )
     LIMIT 1;

    EXIT WHEN v_other IS NULL;

    -- Stale/orphaned group (fewer than 2 live transactions): repair and retry.
    IF public.repair_stale_link_group(v_other) THEN
      CONTINUE;
    END IF;

    RAISE EXCEPTION 'transaction already belongs to active link group %', v_other
      USING ERRCODE = '23505';
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_stale_link_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_stale_links_for_transactions(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repair_stale_links_for_transactions(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.repair_stale_links_for_transactions(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_stale_links_for_transactions(uuid[]) TO service_role;