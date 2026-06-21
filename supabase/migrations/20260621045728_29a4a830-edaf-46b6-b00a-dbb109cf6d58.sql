-- Re-grant table-level SELECT on plaid_items to authenticated. The legacy
-- column-level grant exclusion existed to hide access_token, but that column
-- has been dropped — all remaining columns are connection metadata that the
-- owning user/org needs to read.
GRANT SELECT ON public.plaid_items TO authenticated;

-- Restore org-member SELECT policy on plaid_items so members of the owning
-- organization can read their own connections via RLS (the
-- plaid_items_safe view runs with security_invoker=true and depends on this).
DROP POLICY IF EXISTS "Users can view org plaid items" ON public.plaid_items;
CREATE POLICY "Users can view org plaid items"
ON public.plaid_items
FOR SELECT
TO authenticated
USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));