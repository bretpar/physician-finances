
ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS hsa_coverage_type text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS hsa_age55_catchup boolean NOT NULL DEFAULT false;

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_hsa_coverage_type_check;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_hsa_coverage_type_check
  CHECK (hsa_coverage_type IN ('individual','family'));
