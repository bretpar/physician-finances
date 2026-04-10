
CREATE TABLE public.tax_savings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  savings_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_savings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org tax savings"
  ON public.tax_savings FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org tax savings"
  ON public.tax_savings FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org tax savings"
  ON public.tax_savings FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org tax savings"
  ON public.tax_savings FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_tax_savings_updated_at
  BEFORE UPDATE ON public.tax_savings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
