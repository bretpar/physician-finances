ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS household_w2_income_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_spouse_w2_income_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_additional_w2_job_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_business_1099_income_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_k1_partnership_income_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_scorp_income_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_rental_income_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_investment_income_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS household_other_income_enabled boolean NOT NULL DEFAULT true;