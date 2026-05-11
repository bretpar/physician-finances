
-- 1. Add vault_secret_id column to plaid_items
ALTER TABLE public.plaid_items ADD COLUMN IF NOT EXISTS vault_secret_id uuid;

-- 2. Drop the SELECT policy that exposed plaintext access_token to authenticated clients.
--    Clients must use the plaid_items_safe view which excludes access_token.
--    Edge functions use the service role and bypass RLS.
DROP POLICY IF EXISTS "Owners can view own plaid items metadata" ON public.plaid_items;

-- 3. Harden store_plaid_token_in_vault: enforce caller ownership and lock down EXECUTE
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
  -- Allow service role (no auth.uid()) or the owning user
  IF auth.uid() IS NOT NULL AND auth.uid() <> owner_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO vault.secrets (secret, name, description)
  VALUES (_token, 'plaid_access_token_' || _item_id, 'Plaid access token')
  RETURNING id INTO new_secret_id;

  UPDATE public.plaid_items
  SET vault_secret_id = new_secret_id, access_token = '**vault**'
  WHERE id = _item_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.store_plaid_token_in_vault(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_plaid_token_in_vault(uuid, text) TO service_role;

-- 4. Create get_plaid_access_token: only callable from edge functions via service role
CREATE OR REPLACE FUNCTION public.get_plaid_access_token(_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret_id uuid;
  v_token text;
BEGIN
  SELECT vault_secret_id INTO v_secret_id FROM public.plaid_items WHERE id = _item_id;
  IF v_secret_id IS NULL THEN
    RAISE EXCEPTION 'no vault secret for plaid_item';
  END IF;
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_token;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_plaid_access_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plaid_access_token(uuid) TO service_role;
