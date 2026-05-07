-- 1) entry_kind on income_entries
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS entry_kind text NOT NULL DEFAULT 'regular_paycheck';

ALTER TABLE public.income_entries
  ADD CONSTRAINT income_entries_entry_kind_check
  CHECK (entry_kind IN ('regular_paycheck','one_time_income','ytd_catchup'));

-- 2) ytd_catchup_entries table
CREATE TABLE public.ytd_catchup_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  tax_year integer NOT NULL DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer,
  source_type text NOT NULL DEFAULT 'w2', -- 'w2' | '1099_k1' | 'other'
  company_id uuid,
  company_name text NOT NULL DEFAULT '',
  period_start date NOT NULL DEFAULT (date_trunc('year', CURRENT_DATE))::date,
  period_end date NOT NULL DEFAULT CURRENT_DATE,
  gross_income numeric NOT NULL DEFAULT 0,
  federal_withholding numeric NOT NULL DEFAULT 0,
  state_withholding numeric NOT NULL DEFAULT 0,
  ss_withholding numeric NOT NULL DEFAULT 0,
  medicare_withholding numeric NOT NULL DEFAULT 0,
  retirement_401k numeric NOT NULL DEFAULT 0,
  hsa_contribution numeric NOT NULL DEFAULT 0,
  healthcare_premiums numeric NOT NULL DEFAULT 0,
  dental_vision numeric NOT NULL DEFAULT 0,
  other_pretax numeric NOT NULL DEFAULT 0,
  post_tax_deductions numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ytd_catchup_entries
  ADD CONSTRAINT ytd_catchup_source_type_check
  CHECK (source_type IN ('w2','1099_k1','other'));

-- Validation trigger: end >= start, no negatives
CREATE OR REPLACE FUNCTION public.validate_ytd_catchup_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.period_end < NEW.period_start THEN
    RAISE EXCEPTION 'period_end cannot be before period_start';
  END IF;
  IF NEW.gross_income < 0 THEN
    RAISE EXCEPTION 'gross_income cannot be negative';
  END IF;
  IF NEW.federal_withholding < 0 OR NEW.state_withholding < 0
     OR NEW.ss_withholding < 0 OR NEW.medicare_withholding < 0
     OR NEW.retirement_401k < 0 OR NEW.hsa_contribution < 0
     OR NEW.healthcare_premiums < 0 OR NEW.dental_vision < 0
     OR NEW.other_pretax < 0 OR NEW.post_tax_deductions < 0 THEN
    RAISE EXCEPTION 'withholdings and deductions cannot be negative';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ytd_catchup_validate
BEFORE INSERT OR UPDATE ON public.ytd_catchup_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_ytd_catchup_entry();

CREATE TRIGGER ytd_catchup_updated_at
BEFORE UPDATE ON public.ytd_catchup_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ytd_catchup_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner fallback select ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback insert ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback update ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback delete ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR DELETE TO authenticated
  USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Users can view org ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org ytd_catchup_entries"
  ON public.ytd_catchup_entries FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE INDEX idx_ytd_catchup_user_year ON public.ytd_catchup_entries(user_id, tax_year);