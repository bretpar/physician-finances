ALTER TABLE public.tax_settings
ADD COLUMN IF NOT EXISTS quarterly_tracker_method text NOT NULL DEFAULT 'even';