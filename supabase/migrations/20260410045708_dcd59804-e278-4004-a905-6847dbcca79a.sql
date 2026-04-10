
CREATE TABLE public.tax_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  quarter TEXT NOT NULL DEFAULT 'Q1',
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org tax payments"
  ON public.tax_payments FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org tax payments"
  ON public.tax_payments FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org tax payments"
  ON public.tax_payments FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org tax payments"
  ON public.tax_payments FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_tax_payments_updated_at
  BEFORE UPDATE ON public.tax_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
