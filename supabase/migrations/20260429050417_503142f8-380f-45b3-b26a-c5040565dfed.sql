CREATE TABLE public.investment_income_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  investment_income_type text NOT NULL,
  asset_name_or_ticker text NOT NULL DEFAULT '',
  sale_proceeds numeric NULL,
  cost_basis numeric NULL,
  taxable_amount numeric NOT NULL DEFAULT 0,
  tax_recommendation numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT investment_income_entries_type_check CHECK (investment_income_type IN ('short_term_sale', 'long_term_sale', 'dividend'))
);

ALTER TABLE public.investment_income_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner fallback view investment income entries"
ON public.investment_income_entries
FOR SELECT
TO authenticated
USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback create investment income entries"
ON public.investment_income_entries
FOR INSERT
TO authenticated
WITH CHECK ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback update investment income entries"
ON public.investment_income_entries
FOR UPDATE
TO authenticated
USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback delete investment income entries"
ON public.investment_income_entries
FOR DELETE
TO authenticated
USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Users can view org investment income entries"
ON public.investment_income_entries
FOR SELECT
TO authenticated
USING (organization_id IN (SELECT get_user_org_ids(auth.uid()) AS get_user_org_ids));

CREATE POLICY "Users can create org investment income entries"
ON public.investment_income_entries
FOR INSERT
TO authenticated
WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid()) AS get_user_org_ids));

CREATE POLICY "Users can update org investment income entries"
ON public.investment_income_entries
FOR UPDATE
TO authenticated
USING (organization_id IN (SELECT get_user_org_ids(auth.uid()) AS get_user_org_ids));

CREATE POLICY "Users can delete org investment income entries"
ON public.investment_income_entries
FOR DELETE
TO authenticated
USING (organization_id IN (SELECT get_user_org_ids(auth.uid()) AS get_user_org_ids));

CREATE TRIGGER update_investment_income_entries_updated_at
BEFORE UPDATE ON public.investment_income_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_investment_income_entries_user_date ON public.investment_income_entries(user_id, entry_date DESC);
CREATE INDEX idx_investment_income_entries_org_date ON public.investment_income_entries(organization_id, entry_date DESC);