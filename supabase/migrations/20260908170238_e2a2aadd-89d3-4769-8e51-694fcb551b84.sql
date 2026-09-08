ALTER TABLE public.retirement_contributions
  ADD COLUMN IF NOT EXISTS contribution_type text NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS retirement_contributions_company_id_idx
  ON public.retirement_contributions (company_id);