ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS itemized_deductions_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS salt_property_tax numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salt_state_income_tax_mode text NOT NULL DEFAULT 'estimate',
  ADD COLUMN IF NOT EXISTS salt_state_income_tax_manual numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salt_sales_tax_base numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salt_sales_tax_large_purchases numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salt_personal_property_tax numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salt_force_sales_tax_election boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS salt_cap_override numeric,
  ADD COLUMN IF NOT EXISTS itemized_other_deductions numeric NOT NULL DEFAULT 0;

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_salt_state_income_tax_mode_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_salt_state_income_tax_mode_check
  CHECK (salt_state_income_tax_mode IN ('estimate', 'manual'));