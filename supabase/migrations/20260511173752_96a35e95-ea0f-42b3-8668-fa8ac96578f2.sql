ALTER TABLE public.investment_income_entries
  ADD COLUMN IF NOT EXISTS actual_tax_saved numeric,
  ADD COLUMN IF NOT EXISTS tax_rate_used numeric,
  ADD COLUMN IF NOT EXISTS tax_method_used text;