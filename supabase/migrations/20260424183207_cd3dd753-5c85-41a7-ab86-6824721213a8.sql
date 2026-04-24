CREATE OR REPLACE FUNCTION public.update_planner_cron_secret(_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'planner_cron_secret' LIMIT 1;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(_value, 'planner_cron_secret', 'Shared secret for planner-convert-daily edge function');
  ELSE
    PERFORM vault.update_secret(existing_id, _value);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_planner_cron_secret(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_planner_cron_secret(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_planner_cron_secret(text) TO service_role;