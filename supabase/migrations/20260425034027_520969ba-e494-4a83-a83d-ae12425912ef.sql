ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS include_se_tax_in_recommendation boolean NOT NULL DEFAULT true;