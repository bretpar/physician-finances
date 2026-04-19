
-- Add new tax profile fields to tax_settings
ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS deduction_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS itemized_deduction_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qualifying_children_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_dependents_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withholding_override_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS withholding_override_percent numeric,
  ADD COLUMN IF NOT EXISTS withholding_override_amount numeric;

-- Validation: enums via CHECK using IN list (immutable, safe)
ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_deduction_type_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_deduction_type_check
  CHECK (deduction_type IN ('standard', 'itemized'));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_withholding_override_type_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_withholding_override_type_check
  CHECK (withholding_override_type IN ('none', 'percent', 'amount'));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_nonnegative_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_nonnegative_check
  CHECK (
    itemized_deduction_amount >= 0
    AND qualifying_children_count >= 0
    AND other_dependents_count >= 0
    AND (withholding_override_percent IS NULL OR (withholding_override_percent >= 0 AND withholding_override_percent <= 100))
    AND (withholding_override_amount IS NULL OR withholding_override_amount >= 0)
  );
