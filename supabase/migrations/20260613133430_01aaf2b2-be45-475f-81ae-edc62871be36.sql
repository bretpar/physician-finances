DROP POLICY IF EXISTS "Users can view own plaid item metadata" ON public.plaid_items;
CREATE POLICY "Users can view own plaid item metadata"
ON public.plaid_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);