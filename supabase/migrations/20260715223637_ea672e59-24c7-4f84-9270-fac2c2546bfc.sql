-- Guarantee at most one payroll HSA contribution row per income entry.
-- Partial unique index so manual (non-payroll) rows and rows without a
-- linked income_entry_id are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS hsa_contributions_payroll_income_entry_unique
  ON public.hsa_contributions (income_entry_id)
  WHERE income_entry_id IS NOT NULL AND source_type = 'payroll';