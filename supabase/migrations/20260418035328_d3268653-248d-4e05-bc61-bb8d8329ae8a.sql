
-- Restrict client access to plaid_items.access_token
-- 1. Drop the broad SELECT policy that exposed access_token to all org members
DROP POLICY IF EXISTS "Users can view org plaid items" ON public.plaid_items;

-- 2. Create a safe view that excludes the access_token column
CREATE OR REPLACE VIEW public.plaid_items_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  user_id,
  organization_id,
  institution_id,
  institution_name,
  item_id,
  status,
  cursor,
  last_synced_at,
  created_at,
  updated_at
FROM public.plaid_items;

-- 3. Re-add a restrictive SELECT policy on the base table:
--    only the original connecting user can read their own row, and even then
--    the access_token should be treated as opaque. Edge functions use the
--    service role and bypass RLS, so server-side reads still work.
CREATE POLICY "Owners can view own plaid items metadata"
ON public.plaid_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 4. Grant access to the safe view for authenticated users
GRANT SELECT ON public.plaid_items_safe TO authenticated;
