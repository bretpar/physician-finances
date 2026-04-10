
CREATE TABLE public.stock_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_sale_amount NUMERIC NOT NULL DEFAULT 0,
  cost_basis NUMERIC NOT NULL DEFAULT 0,
  gain_loss NUMERIC NOT NULL DEFAULT 0,
  sale_type TEXT NOT NULL DEFAULT 'short_term',
  estimated_tax NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org stock transactions"
  ON public.stock_transactions FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org stock transactions"
  ON public.stock_transactions FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org stock transactions"
  ON public.stock_transactions FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org stock transactions"
  ON public.stock_transactions FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_stock_transactions_updated_at
  BEFORE UPDATE ON public.stock_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
