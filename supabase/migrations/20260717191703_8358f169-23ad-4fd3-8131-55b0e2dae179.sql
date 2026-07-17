-- =========================================================================
-- 1) SAFETY CLEANUP (idempotent; today's data has no dupes/orphans)
-- =========================================================================

-- 1a. Dedupe linked rows by (income_entry_id, contribution_type). Keep the
-- earliest-created row (canonical), delete newer duplicates.
WITH ranked AS (
  SELECT id,
         income_entry_id,
         contribution_type,
         ROW_NUMBER() OVER (
           PARTITION BY income_entry_id, contribution_type
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.hsa_contributions
   WHERE income_entry_id IS NOT NULL
)
DELETE FROM public.hsa_contributions h
 USING ranked r
 WHERE h.id = r.id AND r.rn > 1;

-- 1b. Remove true orphan LINKED rows (income_entry_id points to a missing
-- income_entry). Individual (unlinked) rows are NEVER touched.
DELETE FROM public.hsa_contributions h
 WHERE h.income_entry_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.income_entries i WHERE i.id = h.income_entry_id
   );

-- 1c. Backfill contribution_type from legacy source_type/role for any row
-- that somehow still has the default. Defensive; noop on clean data.
UPDATE public.hsa_contributions
   SET contribution_type = CASE
     WHEN source_type = 'individual' THEN 'individual'
     WHEN linked_income_entry_role = 'employer' THEN 'employer'
     ELSE 'employee_payroll'
   END
 WHERE contribution_type IS NULL
    OR contribution_type NOT IN ('employee_payroll','employer','individual');

-- =========================================================================
-- 2) CONSTRAINTS
-- =========================================================================

-- 2a. Drop legacy partial uniques that block employee+employer coexistence
-- or duplicate the new (income_entry_id, contribution_type) rule.
DROP INDEX IF EXISTS public.hsa_contributions_payroll_income_entry_unique;
DROP INDEX IF EXISTS public.hsa_contributions_income_entry_role_uniq;

-- 2b. Real FK with CASCADE. Only linked rows (income_entry_id NOT NULL) are
-- affected; individual contributions still allow NULL.
ALTER TABLE public.hsa_contributions
  DROP CONSTRAINT IF EXISTS hsa_contributions_income_entry_id_fkey;
ALTER TABLE public.hsa_contributions
  ADD CONSTRAINT hsa_contributions_income_entry_id_fkey
  FOREIGN KEY (income_entry_id)
  REFERENCES public.income_entries(id)
  ON DELETE CASCADE;

-- 2c. Partial unique on (income_entry_id, contribution_type). Allows one
-- employee_payroll row AND one employer row per income_entry; unlimited
-- individual rows (all have NULL income_entry_id).
CREATE UNIQUE INDEX IF NOT EXISTS hsa_contributions_income_entry_type_uniq
  ON public.hsa_contributions (income_entry_id, contribution_type)
  WHERE income_entry_id IS NOT NULL;

-- =========================================================================
-- 3) ATOMIC RPC: sync employee + employer HSA rows for one income entry
-- =========================================================================
-- Runs in a single transaction. Semantics per role:
--   amount > 0  → INSERT ... ON CONFLICT (income_entry_id, contribution_type)
--                 DO UPDATE (preserves id, refreshes amount/date/company)
--   amount = 0  → DELETE the linked row of that contribution_type (if any)
--   amount NULL → do not touch that role at all
-- Returns { employee_id, employer_id, income_entry_id }.
--
-- Also patches income_entries.linked_hsa_contribution_id and
-- linked_employer_hsa_contribution_id to match, so cached client state
-- stays consistent.
CREATE OR REPLACE FUNCTION public.sync_income_hsa_atomic(
  p_income_entry_id   uuid,
  p_employee_amount   numeric,   -- pass NULL to skip employee side
  p_employer_amount   numeric,   -- pass NULL to skip employer side
  p_contribution_date date DEFAULT NULL,
  p_company_id        uuid DEFAULT NULL,
  p_notes             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry            public.income_entries%ROWTYPE;
  v_caller           uuid := auth.uid();
  v_date             date;
  v_company          uuid;
  v_year             integer;
  v_employee_id      uuid;
  v_employer_id      uuid;
BEGIN
  IF p_income_entry_id IS NULL THEN
    RAISE EXCEPTION 'income_entry_id is required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_entry FROM public.income_entries WHERE id = p_income_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'income_entry % not found', p_income_entry_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Authorization: only the owner or service_role may sync. Service-role
  -- callers have auth.uid() NULL.
  IF v_caller IS NOT NULL AND v_caller <> v_entry.user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  v_date    := COALESCE(p_contribution_date, v_entry.income_date);
  v_company := COALESCE(p_company_id, v_entry.source_id);
  v_year    := EXTRACT(YEAR FROM v_date)::int;

  ---------------------------------------------------------------------------
  -- Employee (payroll) row
  ---------------------------------------------------------------------------
  IF p_employee_amount IS NOT NULL THEN
    IF p_employee_amount > 0 THEN
      INSERT INTO public.hsa_contributions (
        user_id, organization_id, contribution_date, amount,
        company_id, income_entry_id,
        source_type, created_from, tax_year,
        contribution_type, linked_income_entry_role, notes
      ) VALUES (
        v_entry.user_id, v_entry.organization_id, v_date, p_employee_amount,
        v_company, p_income_entry_id,
        'payroll', 'income', v_year,
        'employee_payroll', 'employee', p_notes
      )
      ON CONFLICT (income_entry_id, contribution_type)
      WHERE income_entry_id IS NOT NULL
      DO UPDATE SET
        amount            = EXCLUDED.amount,
        contribution_date = EXCLUDED.contribution_date,
        company_id        = EXCLUDED.company_id,
        tax_year          = EXCLUDED.tax_year,
        organization_id   = EXCLUDED.organization_id,
        source_type       = 'payroll',
        linked_income_entry_role = 'employee',
        updated_at        = now()
      RETURNING id INTO v_employee_id;
    ELSE
      DELETE FROM public.hsa_contributions
       WHERE income_entry_id = p_income_entry_id
         AND contribution_type = 'employee_payroll'
       RETURNING NULL::uuid INTO v_employee_id;
      v_employee_id := NULL;
    END IF;
  ELSE
    -- Untouched: preserve current link
    SELECT id INTO v_employee_id
      FROM public.hsa_contributions
     WHERE income_entry_id = p_income_entry_id
       AND contribution_type = 'employee_payroll';
  END IF;

  ---------------------------------------------------------------------------
  -- Employer row
  ---------------------------------------------------------------------------
  IF p_employer_amount IS NOT NULL THEN
    IF p_employer_amount > 0 THEN
      INSERT INTO public.hsa_contributions (
        user_id, organization_id, contribution_date, amount,
        company_id, income_entry_id,
        source_type, created_from, tax_year,
        contribution_type, linked_income_entry_role, notes
      ) VALUES (
        v_entry.user_id, v_entry.organization_id, v_date, p_employer_amount,
        v_company, p_income_entry_id,
        'payroll', 'income', v_year,
        'employer', 'employer', p_notes
      )
      ON CONFLICT (income_entry_id, contribution_type)
      WHERE income_entry_id IS NOT NULL
      DO UPDATE SET
        amount            = EXCLUDED.amount,
        contribution_date = EXCLUDED.contribution_date,
        company_id        = EXCLUDED.company_id,
        tax_year          = EXCLUDED.tax_year,
        organization_id   = EXCLUDED.organization_id,
        source_type       = 'payroll',
        linked_income_entry_role = 'employer',
        updated_at        = now()
      RETURNING id INTO v_employer_id;
    ELSE
      DELETE FROM public.hsa_contributions
       WHERE income_entry_id = p_income_entry_id
         AND contribution_type = 'employer'
       RETURNING NULL::uuid INTO v_employer_id;
      v_employer_id := NULL;
    END IF;
  ELSE
    SELECT id INTO v_employer_id
      FROM public.hsa_contributions
     WHERE income_entry_id = p_income_entry_id
       AND contribution_type = 'employer';
  END IF;

  ---------------------------------------------------------------------------
  -- Keep income_entries pointers in sync (best-effort; same txn)
  ---------------------------------------------------------------------------
  UPDATE public.income_entries
     SET linked_hsa_contribution_id          = v_employee_id,
         linked_employer_hsa_contribution_id = v_employer_id
   WHERE id = p_income_entry_id
     AND (
       COALESCE(linked_hsa_contribution_id, '00000000-0000-0000-0000-000000000000'::uuid)
         IS DISTINCT FROM COALESCE(v_employee_id, '00000000-0000-0000-0000-000000000000'::uuid)
       OR COALESCE(linked_employer_hsa_contribution_id, '00000000-0000-0000-0000-000000000000'::uuid)
         IS DISTINCT FROM COALESCE(v_employer_id, '00000000-0000-0000-0000-000000000000'::uuid)
     );

  RETURN jsonb_build_object(
    'income_entry_id', p_income_entry_id,
    'employee_id',     v_employee_id,
    'employer_id',     v_employer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text)
  TO authenticated, service_role;