
-- ── hsa_contributions: canonical contribution_type + role tag ─────────────
ALTER TABLE public.hsa_contributions
  ADD COLUMN IF NOT EXISTS contribution_type TEXT,
  ADD COLUMN IF NOT EXISTS linked_income_entry_role TEXT;

-- Backfill from legacy source_type (payroll → employee_payroll).
UPDATE public.hsa_contributions
SET contribution_type = CASE
  WHEN contribution_type IS NOT NULL AND contribution_type <> '' THEN contribution_type
  WHEN source_type = 'payroll' THEN 'employee_payroll'
  WHEN source_type = 'individual' THEN 'individual'
  ELSE 'individual'
END
WHERE contribution_type IS NULL OR contribution_type = '';

-- All income-linked legacy rows are the employee side (only path that existed).
UPDATE public.hsa_contributions
SET linked_income_entry_role = 'employee'
WHERE income_entry_id IS NOT NULL AND linked_income_entry_role IS NULL;

ALTER TABLE public.hsa_contributions
  ALTER COLUMN contribution_type SET DEFAULT 'individual',
  ALTER COLUMN contribution_type SET NOT NULL;

ALTER TABLE public.hsa_contributions
  DROP CONSTRAINT IF EXISTS hsa_contributions_contribution_type_check;
ALTER TABLE public.hsa_contributions
  ADD CONSTRAINT hsa_contributions_contribution_type_check
  CHECK (contribution_type IN ('employee_payroll','employer','individual'));

ALTER TABLE public.hsa_contributions
  DROP CONSTRAINT IF EXISTS hsa_contributions_linked_role_check;
ALTER TABLE public.hsa_contributions
  ADD CONSTRAINT hsa_contributions_linked_role_check
  CHECK (linked_income_entry_role IS NULL
         OR linked_income_entry_role IN ('employee','employer'));

-- One row per (income_entry_id, role) so employee & employer rows have
-- distinct stable identities and cannot overwrite each other.
CREATE UNIQUE INDEX IF NOT EXISTS hsa_contributions_income_entry_role_uniq
  ON public.hsa_contributions (income_entry_id, linked_income_entry_role)
  WHERE income_entry_id IS NOT NULL AND linked_income_entry_role IS NOT NULL;

-- ── income_entries: employer HSA amount + separate link id ────────────────
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS employer_hsa_contribution NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linked_employer_hsa_contribution_id UUID;
