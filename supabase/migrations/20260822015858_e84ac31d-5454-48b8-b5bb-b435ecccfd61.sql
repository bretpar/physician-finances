ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS itemized_mortgage_interest numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS itemized_mortgage_balance numeric;