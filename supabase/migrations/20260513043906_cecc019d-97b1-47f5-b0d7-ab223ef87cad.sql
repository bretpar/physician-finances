DROP POLICY IF EXISTS "Owners can view own plaid items metadata" ON public.plaid_items;

CREATE POLICY "Owners can view own plaid items metadata"
ON public.plaid_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);