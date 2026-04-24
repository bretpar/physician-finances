-- Replace the older helper with one that installs the cron job directly.
DROP FUNCTION IF EXISTS public.update_planner_cron_secret(text);

CREATE OR REPLACE FUNCTION public.install_planner_cron_job(_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cmd text;
BEGIN
  IF _secret IS NULL OR length(_secret) < 8 THEN
    RAISE EXCEPTION 'Invalid secret';
  END IF;

  -- Unschedule existing job if present (idempotent).
  PERFORM cron.unschedule('planner-convert-daily-job')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'planner-convert-daily-job');

  cmd := format(
    $cmd$
    SELECT net.http_post(
      url := 'https://fiqnxprhvsadcqicczkg.supabase.co/functions/v1/planner-convert-daily',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', %L
      ),
      body := '{}'::jsonb
    );
    $cmd$,
    _secret
  );

  PERFORM cron.schedule('planner-convert-daily-job', '0 9 * * *', cmd);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.install_planner_cron_job(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.install_planner_cron_job(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.install_planner_cron_job(text) TO service_role;

-- Best-effort cleanup of the old placeholder Vault entry; ignore if missing.
DO $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'planner_cron_secret';
  IF existing_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = existing_id;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;