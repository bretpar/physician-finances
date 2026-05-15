-- 1. plaid_items: add org-scoped SELECT (currently only owner can see)
CREATE POLICY "Users can view org plaid items"
ON public.plaid_items
FOR SELECT
TO authenticated
USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 2. transaction_attachments: normalize UPDATE/DELETE to the dual pattern
DROP POLICY IF EXISTS "Users can update own attachments" ON public.transaction_attachments;
DROP POLICY IF EXISTS "Users can delete own attachments" ON public.transaction_attachments;

CREATE POLICY "Users can update org attachments"
ON public.transaction_attachments
FOR UPDATE
TO authenticated
USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Owner fallback update transaction_attachments"
ON public.transaction_attachments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Users can delete org attachments"
ON public.transaction_attachments
FOR DELETE
TO authenticated
USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Owner fallback delete transaction_attachments"
ON public.transaction_attachments
FOR DELETE
TO authenticated
USING (auth.uid() = user_id AND organization_id IS NULL);

-- 3. Defense-in-depth: enforce that authenticated INSERT/UPDATE rows
--    keep user_id pinned to the caller's auth.uid().
--    Service-role / trigger contexts (auth.uid() IS NULL) are skipped.
CREATE OR REPLACE FUNCTION public.enforce_user_id_matches_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Only enforce for authenticated end-user calls; allow service-role and
  -- system contexts (handle_new_user, edge functions using service role) to
  -- write rows on behalf of any user_id.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'user_id (%) must match authenticated user (%)', NEW.user_id, auth.uid()
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Disallow re-assigning a row to another user
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'user_id is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach to every user-owned table
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'companies','home_office_deductions','hsa_contributions','income_entries',
    'income_forecasts','income_pathway_history','investment_income_entries',
    'mileage_entries','plaid_accounts','plaid_deleted_tombstones','plaid_items',
    'plaid_transactions','planner_conversions','profiles','projected_bonus_events',
    'projected_income_overrides','projected_income_streams','retirement_contributions',
    'stock_transactions','tax_payments','tax_savings','tax_settings',
    'transaction_attachments','transaction_links','transaction_match_group_items',
    'transaction_match_groups','transaction_match_ignores','transactions',
    'user_roles','ytd_catchup_entries'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_user_id_matches_auth ON public.%I;',
      t
    );
    EXECUTE format(
      'CREATE TRIGGER enforce_user_id_matches_auth
         BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.enforce_user_id_matches_auth();',
      t
    );
  END LOOP;
END $$;