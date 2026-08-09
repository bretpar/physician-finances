CREATE OR REPLACE FUNCTION public.select_my_plan(_plan text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_current text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Self-service plan selection is limited to the two public tiers.
  IF _plan NOT IN ('free','premium') THEN
    RAISE EXCEPTION 'invalid plan: %', _plan USING ERRCODE = '22023';
  END IF;

  v_current := public.get_my_account_role();

  -- Never downgrade an elevated account (premium_beta / developer).
  IF v_current IN ('premium_beta','developer') THEN
    RETURN v_current;
  END IF;

  DELETE FROM public.user_roles r
   WHERE r.user_id = v_uid
     AND public.is_account_level_role(r.role);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, _plan::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _plan;
END;
$$;

REVOKE ALL ON FUNCTION public.select_my_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.select_my_plan(text) TO authenticated;