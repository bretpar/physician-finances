
CREATE TABLE public.income_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  income_type TEXT NOT NULL DEFAULT '1099',
  income_date DATE NOT NULL DEFAULT CURRENT_DATE,
  paycheck_amount NUMERIC NOT NULL DEFAULT 0,
  deposited_amount NUMERIC NOT NULL DEFAULT 0,
  taxes_withheld NUMERIC NOT NULL DEFAULT 0,
  pre_tax_deductions NUMERIC NOT NULL DEFAULT 0,
  retirement_401k NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org income entries"
  ON public.income_entries FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org income entries"
  ON public.income_entries FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org income entries"
  ON public.income_entries FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org income entries"
  ON public.income_entries FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_income_entries_updated_at
  BEFORE UPDATE ON public.income_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
