
-- 1. Master HSA toggle + source company on tax_settings
ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS hsa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hsa_source_company_id UUID NULL;

-- 2. Link paycheck income entries to their auto-created HSA ledger row
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS linked_hsa_contribution_id UUID NULL;

-- 3. New hsa_contributions ledger
CREATE TABLE IF NOT EXISTS public.hsa_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  contribution_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  company_id UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  income_entry_id UUID NULL,
  source_type TEXT NOT NULL DEFAULT 'individual',  -- 'payroll' | 'individual'
  created_from TEXT NOT NULL DEFAULT 'manual',     -- 'income'  | 'manual'
  notes TEXT NULL DEFAULT '',
  tax_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::int,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hsa_source_type_chk CHECK (source_type IN ('payroll','individual')),
  CONSTRAINT hsa_created_from_chk CHECK (created_from IN ('income','manual'))
);

CREATE INDEX IF NOT EXISTS idx_hsa_contributions_user_year ON public.hsa_contributions (user_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_hsa_contributions_org_year  ON public.hsa_contributions (organization_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_hsa_contributions_income    ON public.hsa_contributions (income_entry_id);

-- Validation trigger: amount must be >= 0
CREATE OR REPLACE FUNCTION public.validate_hsa_contribution()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.amount < 0 THEN
    RAISE EXCEPTION 'HSA contribution amount cannot be negative';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hsa_contributions_validate ON public.hsa_contributions;
CREATE TRIGGER hsa_contributions_validate
  BEFORE INSERT OR UPDATE ON public.hsa_contributions
  FOR EACH ROW EXECUTE FUNCTION public.validate_hsa_contribution();

DROP TRIGGER IF EXISTS hsa_contributions_updated_at ON public.hsa_contributions;
CREATE TRIGGER hsa_contributions_updated_at
  BEFORE UPDATE ON public.hsa_contributions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.hsa_contributions ENABLE ROW LEVEL SECURITY;

-- Org-scoped policies
CREATE POLICY "Users can view org hsa contributions"
  ON public.hsa_contributions FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org hsa contributions"
  ON public.hsa_contributions FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org hsa contributions"
  ON public.hsa_contributions FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org hsa contributions"
  ON public.hsa_contributions FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

-- Owner fallback policies (for rows with no org)
CREATE POLICY "Owner fallback select hsa_contributions"
  ON public.hsa_contributions FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Owner fallback insert hsa_contributions"
  ON public.hsa_contributions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Owner fallback update hsa_contributions"
  ON public.hsa_contributions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Owner fallback delete hsa_contributions"
  ON public.hsa_contributions FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);
