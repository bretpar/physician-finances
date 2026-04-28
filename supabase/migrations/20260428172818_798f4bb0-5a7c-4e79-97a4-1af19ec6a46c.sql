ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS onboarding_step integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_tax_settings_onboarding_step
  ON public.tax_settings (onboarding_step);