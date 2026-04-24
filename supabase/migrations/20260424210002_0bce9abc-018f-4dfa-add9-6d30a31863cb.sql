ALTER TABLE public.tax_settings
ADD COLUMN IF NOT EXISTS state_income_tax_enabled boolean NOT NULL DEFAULT false;

UPDATE public.tax_settings
SET state_income_tax_enabled = COALESCE(state_tax_enabled, false)
WHERE state_income_tax_enabled IS DISTINCT FROM COALESCE(state_tax_enabled, false);