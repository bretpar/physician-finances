REVOKE ALL ON FUNCTION public.enforce_single_active_link_group() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_single_active_link_group() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_single_active_link_group() FROM authenticated;