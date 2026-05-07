ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS ytd_catchup_choice text
  CHECK (ytd_catchup_choice IN ('yes','no','skip'));