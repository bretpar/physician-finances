ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS employee_role text,
  ADD COLUMN IF NOT EXISTS projected_annual_gross numeric,
  ADD COLUMN IF NOT EXISTS expected_federal_withholding_per_paycheck numeric;