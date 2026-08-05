ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'free';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'premium';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'premium_beta';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'developer';

CREATE OR REPLACE FUNCTION public.get_account_role(_user_id uuid)
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
      WHERE r.user_id = _user_id
    ),
    'free'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_account_role(uuid) TO authenticated;