-- Rename owner_healthcare -> healthcare_deduction on the three income tables
ALTER TABLE public.income_entries RENAME COLUMN owner_healthcare TO healthcare_deduction;
ALTER TABLE public.projected_income_streams RENAME COLUMN owner_healthcare TO healthcare_deduction;

-- projected_income_overrides does not have owner_healthcare; skip there.

-- Add hsa_contribution columns
ALTER TABLE public.income_entries
  ADD COLUMN hsa_contribution numeric NOT NULL DEFAULT 0;

ALTER TABLE public.projected_income_streams
  ADD COLUMN hsa_contribution numeric NOT NULL DEFAULT 0;

ALTER TABLE public.projected_income_overrides
  ADD COLUMN hsa_contribution numeric NOT NULL DEFAULT 0;

ALTER TABLE public.projected_income_overrides
  ADD COLUMN healthcare_deduction numeric NOT NULL DEFAULT 0;
