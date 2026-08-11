-- 1) Lock down anon EXECUTE on the SECURITY DEFINER HSA sync function
REVOKE EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) TO service_role;

-- Defense in depth: an unauthenticated (non service_role) caller may never run this.
CREATE OR REPLACE FUNCTION public.sync_income_hsa_atomic(p_income_entry_id uuid, p_employee_amount numeric, p_employer_amount numeric, p_contribution_date date DEFAULT NULL::date, p_company_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry            public.income_entries%ROWTYPE;
  v_caller           uuid := auth.uid();
  v_date             date;
  v_company          uuid;
  v_year             integer;
  v_employee_id      uuid;
  v_employer_id      uuid;
BEGIN
  IF v_caller IS NULL AND current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_income_entry_id IS NULL THEN
    RAISE EXCEPTION 'income_entry_id is required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_entry FROM public.income_entries WHERE id = p_income_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'income_entry % not found', p_income_entry_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_caller IS NOT NULL AND v_caller <> v_entry.user_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  v_date    := COALESCE(p_contribution_date, v_entry.income_date);
  v_company := COALESCE(p_company_id, v_entry.source_id);
  v_year    := EXTRACT(YEAR FROM v_date)::int;

  IF p_employee_amount IS NOT NULL THEN
    IF p_employee_amount > 0 THEN
      INSERT INTO public.hsa_contributions (
        user_id, organization_id, contribution_date, amount,
        company_id, income_entry_id,
        source_type, created_from, tax_year,
        contribution_type, linked_income_entry_role, notes
      ) VALUES (
        v_entry.user_id, v_entry.organization_id, v_date, p_employee_amount,
        v_company, p_income_entry_id,
        'payroll', 'income', v_year,
        'employee_payroll', 'employee', p_notes
      )
      ON CONFLICT (income_entry_id, contribution_type)
      WHERE income_entry_id IS NOT NULL
      DO UPDATE SET
        amount            = EXCLUDED.amount,
        contribution_date = EXCLUDED.contribution_date,
        company_id        = EXCLUDED.company_id,
        tax_year          = EXCLUDED.tax_year,
        organization_id   = EXCLUDED.organization_id,
        source_type       = 'payroll',
        linked_income_entry_role = 'employee',
        updated_at        = now()
      RETURNING id INTO v_employee_id;
    ELSE
      DELETE FROM public.hsa_contributions
       WHERE income_entry_id = p_income_entry_id
         AND contribution_type = 'employee_payroll'
       RETURNING NULL::uuid INTO v_employee_id;
      v_employee_id := NULL;
    END IF;
  ELSE
    SELECT id INTO v_employee_id
      FROM public.hsa_contributions
     WHERE income_entry_id = p_income_entry_id
       AND contribution_type = 'employee_payroll';
  END IF;

  IF p_employer_amount IS NOT NULL THEN
    IF p_employer_amount > 0 THEN
      INSERT INTO public.hsa_contributions (
        user_id, organization_id, contribution_date, amount,
        company_id, income_entry_id,
        source_type, created_from, tax_year,
        contribution_type, linked_income_entry_role, notes
      ) VALUES (
        v_entry.user_id, v_entry.organization_id, v_date, p_employer_amount,
        v_company, p_income_entry_id,
        'payroll', 'income', v_year,
        'employer', 'employer', p_notes
      )
      ON CONFLICT (income_entry_id, contribution_type)
      WHERE income_entry_id IS NOT NULL
      DO UPDATE SET
        amount            = EXCLUDED.amount,
        contribution_date = EXCLUDED.contribution_date,
        company_id        = EXCLUDED.company_id,
        tax_year          = EXCLUDED.tax_year,
        organization_id   = EXCLUDED.organization_id,
        source_type       = 'payroll',
        linked_income_entry_role = 'employer',
        updated_at        = now()
      RETURNING id INTO v_employer_id;
    ELSE
      DELETE FROM public.hsa_contributions
       WHERE income_entry_id = p_income_entry_id
         AND contribution_type = 'employer'
       RETURNING NULL::uuid INTO v_employer_id;
      v_employer_id := NULL;
    END IF;
  ELSE
    SELECT id INTO v_employer_id
      FROM public.hsa_contributions
     WHERE income_entry_id = p_income_entry_id
       AND contribution_type = 'employer';
  END IF;

  UPDATE public.income_entries
     SET linked_hsa_contribution_id          = v_employee_id,
         linked_employer_hsa_contribution_id = v_employer_id
   WHERE id = p_income_entry_id
     AND (
       COALESCE(linked_hsa_contribution_id, '00000000-0000-0000-0000-000000000000'::uuid)
         IS DISTINCT FROM COALESCE(v_employee_id, '00000000-0000-0000-0000-000000000000'::uuid)
       OR COALESCE(linked_employer_hsa_contribution_id, '00000000-0000-0000-0000-000000000000'::uuid)
         IS DISTINCT FROM COALESCE(v_employer_id, '00000000-0000-0000-0000-000000000000'::uuid)
     );

  RETURN jsonb_build_object(
    'income_entry_id', p_income_entry_id,
    'employee_id',     v_employee_id,
    'employer_id',     v_employer_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_income_hsa_atomic(uuid, numeric, numeric, date, uuid, text) TO service_role;

-- 2) Restrict direct reads of feature_access_overrides to developers,
--    and expose only feature_key/access_level to signed-in users via a function.
DROP POLICY IF EXISTS "Anyone signed in can read feature overrides" ON public.feature_access_overrides;

CREATE POLICY "Developers can read feature overrides"
ON public.feature_access_overrides
FOR SELECT
TO authenticated
USING (public.get_my_account_role() = 'developer');

CREATE OR REPLACE FUNCTION public.get_feature_access_overrides()
RETURNS TABLE(feature_key text, access_level text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.feature_key, o.access_level
    FROM public.feature_access_overrides o
   WHERE auth.uid() IS NOT NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_feature_access_overrides() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_feature_access_overrides() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_feature_access_overrides() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_feature_access_overrides() TO service_role;