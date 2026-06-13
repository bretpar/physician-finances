DROP POLICY IF EXISTS "Owners can view own plaid items metadata" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can view own plaid item metadata" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can view org plaid items" ON public.plaid_items;

DROP VIEW IF EXISTS public.plaid_items_safe;

CREATE VIEW public.plaid_items_safe AS
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
  last_sync_attempt_at,
  last_successful_sync_at,
  last_sync_error,
  sync_status,
  webhook_url,
  created_at,
  updated_at
FROM public.plaid_items
WHERE
  auth.uid() = user_id
  OR organization_id IN (SELECT public.get_user_org_ids(auth.uid()));

GRANT SELECT ON public.plaid_items_safe TO authenticated;