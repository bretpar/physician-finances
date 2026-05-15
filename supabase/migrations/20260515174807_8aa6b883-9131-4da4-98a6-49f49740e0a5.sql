ALTER TABLE public.projected_income_streams
  ADD COLUMN IF NOT EXISTS forecast_expense_per_period numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forecast_expense_notes text NOT NULL DEFAULT '';