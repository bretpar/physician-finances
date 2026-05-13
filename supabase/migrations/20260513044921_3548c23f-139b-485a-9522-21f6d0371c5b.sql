REVOKE SELECT (access_token) ON public.plaid_items FROM anon, authenticated;
REVOKE SELECT (access_token) ON public.plaid_items FROM PUBLIC;