ALTER TABLE public.tax_settings
ADD COLUMN withholding_method text NOT NULL DEFAULT 'dynamic_actual';
