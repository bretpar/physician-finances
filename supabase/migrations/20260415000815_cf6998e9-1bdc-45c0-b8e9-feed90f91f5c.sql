
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS base_tax_estimate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dynamic_tax_recommendation numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quarterly_adjustment_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_tax_reserve numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommendation_status text NOT NULL DEFAULT 'on_track';
