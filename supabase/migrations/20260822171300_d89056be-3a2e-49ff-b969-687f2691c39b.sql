REVOKE ALL ON FUNCTION public.link_group_is_active(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_group_is_active(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_group_is_active(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.link_group_is_active(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.repair_stale_link_group(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.repair_stale_link_group(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.repair_stale_link_group(uuid) TO service_role;