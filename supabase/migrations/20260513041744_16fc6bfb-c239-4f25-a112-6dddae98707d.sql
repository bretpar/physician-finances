
ALTER FUNCTION public.store_plaid_token_in_vault(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.get_plaid_access_token(uuid) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.store_plaid_token_in_vault(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_plaid_access_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_plaid_token_in_vault(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_plaid_access_token(uuid) TO service_role;
