DROP POLICY IF EXISTS "Users can view org plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Owners can view own plaid items metadata" ON public.plaid_items;

CREATE POLICY "Users can view org plaid items"
  ON public.plaid_items
  FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Owners can view own plaid items metadata"
  ON public.plaid_items
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);