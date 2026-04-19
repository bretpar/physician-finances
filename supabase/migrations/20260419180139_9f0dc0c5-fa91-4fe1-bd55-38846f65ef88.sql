-- ─── State Tax Support Migration ───

-- 1. tax_settings: new state-tax fields (personal + business)
ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS state_tax_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS state_of_residence text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS personal_state_tax_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS personal_state_tax_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_state_tax_annual_estimate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS business_state_tax_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_state_tax_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS business_state_tax_base text NOT NULL DEFAULT 'net_profit',
  ADD COLUMN IF NOT EXISTS business_state_tax_application_mode text NOT NULL DEFAULT 'all_business',
  ADD COLUMN IF NOT EXISTS business_state_tax_company_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- Validation: personal_state_tax_mode ∈ {none, flat_rate, annual_estimate}
ALTER TABLE public.tax_settings DROP CONSTRAINT IF EXISTS tax_settings_personal_state_tax_mode_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_personal_state_tax_mode_check
  CHECK (personal_state_tax_mode IN ('none', 'flat_rate', 'annual_estimate'));

-- Validation: business_state_tax_base ∈ {net_profit, gross}
ALTER TABLE public.tax_settings DROP CONSTRAINT IF EXISTS tax_settings_business_state_tax_base_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_business_state_tax_base_check
  CHECK (business_state_tax_base IN ('net_profit', 'gross'));

-- Validation: business_state_tax_application_mode ∈ {all_business, selected}
ALTER TABLE public.tax_settings DROP CONSTRAINT IF EXISTS tax_settings_business_state_tax_app_mode_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_business_state_tax_app_mode_check
  CHECK (business_state_tax_application_mode IN ('all_business', 'selected'));

-- 2. companies: per-company toggle for "apply business state tax to this company"
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS apply_business_state_tax boolean NOT NULL DEFAULT true;

-- Note: income_entries.federal_withholding / state_withholding / ss_withholding /
-- medicare_withholding already exist (default 0). No schema change needed there.