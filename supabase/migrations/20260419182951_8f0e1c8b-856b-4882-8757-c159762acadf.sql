ALTER TABLE public.tax_settings
  DROP COLUMN IF EXISTS federal_rate,
  DROP COLUMN IF EXISTS state_rate,
  DROP COLUMN IF EXISTS bno_rate;