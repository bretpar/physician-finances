ALTER TABLE public.projected_income_streams
  ADD COLUMN IF NOT EXISTS ui_income_subtype text,
  ADD COLUMN IF NOT EXISTS federal_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ss_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medicare_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_healthcare numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_tax_reserve numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';