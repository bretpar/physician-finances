
ALTER TABLE public.plaid_items
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS webhook_url text;

UPDATE public.plaid_items
   SET last_successful_sync_at = last_synced_at
 WHERE last_successful_sync_at IS NULL
   AND last_synced_at IS NOT NULL;

DROP VIEW IF EXISTS public.plaid_items_safe;

CREATE VIEW public.plaid_items_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  user_id,
  organization_id,
  institution_id,
  institution_name,
  item_id,
  status,
  cursor,
  last_synced_at,
  last_sync_attempt_at,
  last_successful_sync_at,
  last_sync_error,
  sync_status,
  webhook_url,
  created_at,
  updated_at
FROM public.plaid_items;

GRANT SELECT ON public.plaid_items_safe TO authenticated;

CREATE OR REPLACE FUNCTION public.install_plaid_sync_cron_job(_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- 10:00 UTC = 2:00 AM PST / 3:00 AM PDT
  PERFORM cron.schedule('plaid-sync-transactions-daily', '0 10 * * *', cmd);
END;
$function$;
