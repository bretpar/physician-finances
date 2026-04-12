
CREATE TABLE public.projected_income_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES public.projected_income_streams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  override_date DATE NOT NULL,
  action TEXT NOT NULL DEFAULT 'modify',
  paycheck_amount NUMERIC NOT NULL DEFAULT 0,
  taxes_withheld NUMERIC NOT NULL DEFAULT 0,
  retirement_401k NUMERIC NOT NULL DEFAULT 0,
  pre_tax_deductions NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stream_id, override_date)
);

ALTER TABLE public.projected_income_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org overrides"
  ON public.projected_income_overrides FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org overrides"
  ON public.projected_income_overrides FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org overrides"
  ON public.projected_income_overrides FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org overrides"
  ON public.projected_income_overrides FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_projected_income_overrides_updated_at
  BEFORE UPDATE ON public.projected_income_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
