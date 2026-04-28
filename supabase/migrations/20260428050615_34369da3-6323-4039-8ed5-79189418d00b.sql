ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean,
  ADD COLUMN IF NOT EXISTS onboarding_banner_dismissed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_first_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS income_profile_type text NOT NULL DEFAULT 'w2_plus_business',
  ADD COLUMN IF NOT EXISTS enabled_income_sources jsonb NOT NULL DEFAULT '{"w2": true, "form1099": true, "k1": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS enabled_personal_income_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS tax_recommendation_method text NOT NULL DEFAULT 'dynamic_planner',
  ADD COLUMN IF NOT EXISTS flat_federal_rate numeric,
  ADD COLUMN IF NOT EXISTS flat_state_rate numeric,
  ADD COLUMN IF NOT EXISTS deduction_strategy text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS enabled_deduction_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'premium';

CREATE INDEX IF NOT EXISTS idx_tax_settings_onboarding_complete
  ON public.tax_settings (onboarding_complete);

CREATE INDEX IF NOT EXISTS idx_tax_settings_subscription_tier
  ON public.tax_settings (subscription_tier);