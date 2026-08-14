ALTER TABLE public.projected_income_overrides
  ADD COLUMN IF NOT EXISTS federal_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ss_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medicare_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_tax_reserve numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_detailed_breakdown boolean NOT NULL DEFAULT false;