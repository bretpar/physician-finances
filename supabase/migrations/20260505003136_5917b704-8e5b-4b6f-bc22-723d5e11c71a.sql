CREATE OR REPLACE FUNCTION public.install_plaid_sync_cron_job(_secret text)
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

  PERFORM cron.unschedule('plaid-sync-transactions-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'plaid-sync-transactions-daily');

  cmd := format(
    $cmd$
    SELECT net.http_post(
      url := 'https://fiqnxprhvsadcqicczkg.supabase.co/functions/v1/plaid-sync-transactions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', %L
      ),
      body := '{}'::jsonb
    );
    $cmd$,
    _secret
  );

  PERFORM cron.schedule('plaid-sync-transactions-daily', '15 8 * * *', cmd);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.install_plaid_sync_cron_job(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.install_plaid_sync_cron_job(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.install_plaid_sync_cron_job(text) TO service_role;

-- Auto-install with the configured CRON_SECRET so the schedule is live immediately.
DO $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_secret := NULL;
  END;
  IF v_secret IS NOT NULL AND length(v_secret) >= 8 THEN
    PERFORM public.install_plaid_sync_cron_job(v_secret);
  END IF;
END $$;