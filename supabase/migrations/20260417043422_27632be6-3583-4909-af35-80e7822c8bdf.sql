ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS advanced_field_visibility jsonb NOT NULL DEFAULT '{}'::jsonb;