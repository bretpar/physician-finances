-- 1) Collapse pre-existing duplicate active links so the uniqueness rules can apply.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY manual_transaction_id ORDER BY linked_at DESC, created_at DESC, id) AS rn
    FROM public.transaction_links
   WHERE status = 'linked' AND manual_transaction_id IS NOT NULL
)
UPDATE public.transaction_links l
   SET status = 'superseded'
  FROM ranked r
 WHERE l.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY plaid_transaction_record_id ORDER BY linked_at DESC, created_at DESC, id) AS rn
    FROM public.transaction_links
   WHERE status = 'linked' AND plaid_transaction_record_id IS NOT NULL
)
UPDATE public.transaction_links l
   SET status = 'superseded'
  FROM ranked r
 WHERE l.id = r.id AND r.rn > 1;

-- 2) One active link per transaction, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS transaction_links_active_manual_uniq
  ON public.transaction_links (manual_transaction_id)
  WHERE status = 'linked' AND manual_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_links_active_plaid_uniq
  ON public.transaction_links (plaid_transaction_record_id)
  WHERE status = 'linked' AND plaid_transaction_record_id IS NOT NULL;

-- 3) Atomic, concurrency-safe auto-link of one expense pair.
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
BEGIN
  IF _manual_tx_id IS NULL OR _plaid_tx_id IS NULL OR _manual_tx_id = _plaid_tx_id THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'invalid_arguments');
  END IF;

  -- Lock both rows in a stable order to avoid deadlocks between concurrent syncs.
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

  IF v_caller IS NOT NULL AND v_caller IS DISTINCT FROM v_manual.user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Expense ↔ expense only; income/paycheck matching is untouched.
  IF COALESCE(v_manual.transaction_type, 'expense') <> 'expense'
     OR COALESCE(v_plaid.transaction_type, 'expense') <> 'expense' THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'not_expense');
  END IF;

  IF COALESCE(v_manual.source_type, 'manual') <> 'manual' OR v_plaid.source_type <> 'plaid' THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'wrong_sides');
  END IF;

  -- Re-check eligibility at link time: still active and not already linked.
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

  -- ≤ 2 calendar days apart.
  IF abs(v_plaid.transaction_date - v_manual.transaction_date) > 2 THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'date_out_of_range');
  END IF;

  -- Imported amount within 1% of the MANUAL amount (manual is the denominator).
  v_manual_amt := abs(COALESCE(v_manual.amount, 0));
  v_plaid_amt  := abs(COALESCE(v_plaid.amount, 0));
  IF v_manual_amt = 0 THEN
    IF v_plaid_amt <> 0 THEN
      RETURN jsonb_build_object('linked', false, 'reason', 'amount_out_of_range');
    END IF;
  ELSIF abs(v_plaid_amt - v_manual_amt) / v_manual_amt > 0.01 + 1e-9 THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'amount_out_of_range');
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

  -- Manual row stays canonical/active. Only link bookkeeping and denormalized
  -- imported metadata change; receipt, category, notes, company/entity/source
  -- assignment and every other enriched field are left untouched.
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

  -- Imported duplicate is soft-marked merged so it is never double-counted.
  UPDATE public.transactions
     SET status = 'merged',
         match_status = 'linked',
         linked_group_id = v_group_id
   WHERE id = _plaid_tx_id;

  RETURN jsonb_build_object('linked', true, 'linked_group_id', v_group_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) TO service_role;