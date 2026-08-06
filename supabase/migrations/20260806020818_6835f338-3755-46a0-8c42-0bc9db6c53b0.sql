-- Allow a narrowly-scoped, developer-verified admin function to write
-- user_roles rows for other users without weakening the general guard.
CREATE OR REPLACE FUNCTION public.enforce_user_id_matches_auth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Set only inside public.admin_set_account_role() (developer-verified).
  IF current_setting('app.admin_role_update', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'user_id (%) must match authenticated user (%)', NEW.user_id, auth.uid()
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'user_id is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Roles that constitute the single account-level role (excludes org/team roles).
CREATE OR REPLACE FUNCTION public.is_account_level_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT _role::text IN ('free','premium','premium_beta','developer','admin','super_admin');
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  account_role text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.get_my_account_role() IS DISTINCT FROM 'developer' THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), '')::text,
    COALESCE(
      (SELECT CASE
         WHEN bool_or(r.role::text IN ('developer','super_admin','admin')) THEN 'developer'
         WHEN bool_or(r.role::text = 'premium_beta') THEN 'premium_beta'
         WHEN bool_or(r.role::text = 'premium') THEN 'premium'
         ELSE 'free'
       END
       FROM public.user_roles r WHERE r.user_id = u.id),
      'free')::text,
    u.created_at,
    u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  ORDER BY u.created_at DESC
  LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_account_role(_user_id uuid, _role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_developer_count int;
  v_target_is_developer boolean;
BEGIN
  IF public.get_my_account_role() IS DISTINCT FROM 'developer' THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _role NOT IN ('free','premium','premium_beta','developer') THEN
    RAISE EXCEPTION 'invalid role: %', _role USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
     WHERE r.user_id = _user_id
       AND r.role::text IN ('developer','super_admin','admin')
  ) INTO v_target_is_developer;

  IF v_target_is_developer AND _role <> 'developer' THEN
    SELECT COUNT(DISTINCT r.user_id) INTO v_developer_count
      FROM public.user_roles r
     WHERE r.role::text IN ('developer','super_admin','admin');
    IF v_developer_count <= 1 THEN
      RAISE EXCEPTION 'cannot demote the last remaining developer' USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM set_config('app.admin_role_update', '1', true);

  -- Canonical storage: exactly one account-level row; org/team roles untouched.
  DELETE FROM public.user_roles r
   WHERE r.user_id = _user_id
     AND public.is_account_level_role(r.role);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, _role::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  PERFORM set_config('app.admin_role_update', '0', true);

  RETURN _role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_account_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_role(uuid, text) TO authenticated;