-- Add new columns to income_entries for unified income architecture
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS source_bucket text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS tax_category text NOT NULL DEFAULT 'ordinary',
  ADD COLUMN IF NOT EXISTS gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_basis numeric,
  ADD COLUMN IF NOT EXISTS realized_gain_loss numeric,
  ADD COLUMN IF NOT EXISTS federal_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_actual boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_in_tax_estimate boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_in_cash_flow boolean NOT NULL DEFAULT false;

-- Migrate existing data: copy paycheck_amount → gross_amount, taxes_withheld → federal_withholding
UPDATE public.income_entries
SET gross_amount = paycheck_amount,
    federal_withholding = taxes_withheld
WHERE gross_amount = 0;