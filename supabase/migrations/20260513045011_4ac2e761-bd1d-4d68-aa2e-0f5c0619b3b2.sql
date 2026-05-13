-- Replace broad table-level SELECT with column-level grants that exclude access_token.
REVOKE SELECT ON public.plaid_items FROM anon, authenticated;
GRANT SELECT (
  id, user_id, organization_id, item_id, institution_id, institution_name,
  status, cursor, last_synced_at, vault_secret_id, created_at, updated_at
) ON public.plaid_items TO authenticated;
-- anon gets nothing (RLS already blocks, but make it explicit at the privilege layer).