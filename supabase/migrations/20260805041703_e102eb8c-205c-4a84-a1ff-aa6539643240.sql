DROP FUNCTION IF EXISTS public.get_account_role(uuid);

CREATE OR REPLACE FUNCTION public.get_my_account_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN bool_or(r.role::text IN ('developer', 'super_admin', 'admin')) THEN 'developer'
        WHEN bool_or(r.role::text = 'premium_beta') THEN 'premium_beta'
        WHEN bool_or(r.role::text = 'premium') THEN 'premium'
        ELSE 'free'
      END
      FROM public.user_roles r
      WHERE r.user_id = auth.uid()
    ),
    'free'
  )
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_my_account_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_account_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_role() TO authenticated;