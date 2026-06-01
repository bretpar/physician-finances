ALTER TABLE public.tax_settings
ADD COLUMN IF NOT EXISTS w2_paycheck_rec_method text NOT NULL DEFAULT 'annual_w4';

ALTER TABLE public.tax_settings
ADD CONSTRAINT tax_settings_w2_paycheck_rec_method_chk
CHECK (w2_paycheck_rec_method IN ('paycheck_target', 'annual_w4'));