-- The store_plaid_token_in_vault function is SECURITY DEFINER owned by postgres,
-- but inserting into vault.secrets requires access to vault's internal crypto helpers.
-- Recreate it using vault.create_secret() which encapsulates the encryption properly,
-- and grant the necessary execute permission.

CREATE OR REPLACE FUNCTION public.store_plaid_token_in_vault(_item_id uuid, _token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_secret_id uuid;
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM public.plaid_items WHERE id = _item_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'plaid_item not found';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> owner_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Use vault.create_secret() which handles encryption internally with the
  -- correct privileges, instead of INSERTing directly into vault.secrets.
  new_secret_id := vault.create_secret(
    _token,
    'plaid_access_token_' || _item_id::text,
    'Plaid access token'
  );

  UPDATE public.plaid_items
  SET vault_secret_id = new_secret_id, access_token = '**vault**'
  WHERE id = _item_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.store_plaid_token_in_vault(uuid, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_plaid_token_in_vault(uuid, text) TO service_role;