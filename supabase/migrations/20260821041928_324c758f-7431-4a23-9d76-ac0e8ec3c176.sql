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
  v_linked int := 0;
  v_considered int := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('linked', 0, 'considered', 0, 'reason', 'no_user');
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    WITH eligible AS (
      SELECT id, transaction_date, abs(COALESCE(amount, 0)) AS amt,
             COALESCE(source_type, 'manual') AS src
        FROM public.transactions
       WHERE user_id = v_user
         AND COALESCE(transaction_type, 'expense') = 'expense'
         AND COALESCE(status, 'active') = 'active'
         AND COALESCE(match_status, 'unmatched') <> 'linked'
         AND linked_group_id IS NULL
    ),
    -- Every (imported, manual) combination that satisfies the strict criteria:
    -- ≤ 2 calendar days apart and imported amount within 1% of the MANUAL amount.
    candidates AS (
      SELECT p.id AS plaid_id, m.id AS manual_id
        FROM eligible p
        JOIN eligible m
          ON m.src = 'manual'
         AND abs(p.transaction_date - m.transaction_date) <= 2
         AND (
              (m.amt = 0 AND p.amt = 0)
              OR (m.amt > 0 AND abs(p.amt - m.amt) / m.amt <= 0.01 + 1e-9)
             )
       WHERE p.src = 'plaid'
    ),
    -- Exactly one qualifying manual candidate per imported row …
    single_manual AS (
      SELECT plaid_id, min(manual_id::text)::uuid AS manual_id
        FROM candidates
       GROUP BY plaid_id
      HAVING count(*) = 1
    )
    -- … and that manual row must not be claimed by another imported row.
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
GRANT EXECUTE ON FUNCTION public.auto_link_expenses_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_link_expenses_for_user(uuid) TO service_role;