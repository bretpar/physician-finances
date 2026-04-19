ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS ss_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medicare_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ui_income_subtype text;