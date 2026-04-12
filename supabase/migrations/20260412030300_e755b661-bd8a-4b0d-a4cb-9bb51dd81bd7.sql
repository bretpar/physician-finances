ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'projected_brackets',
  ADD COLUMN IF NOT EXISTS manual_effective_tax_rate numeric DEFAULT NULL;