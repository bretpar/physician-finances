
-- Drop the failed migration function if it exists
DROP FUNCTION IF EXISTS public.migrate_plaid_tokens_to_vault();

-- ============================================================
-- TIGHTEN TAX-CRITICAL TABLE WRITE POLICIES
-- ============================================================

-- tax_settings: restrict INSERT/UPDATE to admin/owner
DROP POLICY IF EXISTS "Users can create org tax settings" ON public.tax_settings;
DROP POLICY IF EXISTS "Users can update org tax settings" ON public.tax_settings;

CREATE POLICY "Admins/owners can create org tax settings"
ON public.tax_settings
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (SELECT get_user_org_ids(auth.uid()))
  AND is_org_admin_or_owner(auth.uid(), organization_id)
);

CREATE POLICY "Admins/owners can update org tax settings"
ON public.tax_settings
FOR UPDATE
TO authenticated
USING (
  organization_id IN (SELECT get_user_org_ids(auth.uid()))
  AND is_org_admin_or_owner(auth.uid(), organization_id)
);

-- tax_payments: restrict INSERT/UPDATE/DELETE to admin/owner
DROP POLICY IF EXISTS "Users can create org tax payments" ON public.tax_payments;
DROP POLICY IF EXISTS "Users can update org tax payments" ON public.tax_payments;
DROP POLICY IF EXISTS "Users can delete org tax payments" ON public.tax_payments;

CREATE POLICY "Admins/owners can create org tax payments"
ON public.tax_payments
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (SELECT get_user_org_ids(auth.uid()))
  AND is_org_admin_or_owner(auth.uid(), organization_id)
);

CREATE POLICY "Admins/owners can update org tax payments"
ON public.tax_payments
FOR UPDATE
TO authenticated
USING (
  organization_id IN (SELECT get_user_org_ids(auth.uid()))
  AND is_org_admin_or_owner(auth.uid(), organization_id)
);

CREATE POLICY "Admins/owners can delete org tax payments"
ON public.tax_payments
FOR DELETE
TO authenticated
USING (
  organization_id IN (SELECT get_user_org_ids(auth.uid()))
  AND is_org_admin_or_owner(auth.uid(), organization_id)
);

-- ============================================================
-- VAULT HELPER: store plaid token securely
-- ============================================================

CREATE OR REPLACE FUNCTION public.store_plaid_token_in_vault(_item_id uuid, _token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_secret_id uuid;
BEGIN
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (_token, 'plaid_access_token_' || _item_id, 'Plaid access token')
  RETURNING id INTO new_secret_id;

  UPDATE public.plaid_items
  SET vault_secret_id = new_secret_id, access_token = '**vault**'
  WHERE id = _item_id;
END;
$$;
