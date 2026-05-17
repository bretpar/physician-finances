ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_into_company_id uuid;

CREATE INDEX IF NOT EXISTS idx_companies_active
  ON public.companies (user_id)
  WHERE archived_at IS NULL;