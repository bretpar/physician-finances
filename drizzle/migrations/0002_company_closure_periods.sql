CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.company_closure_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  closed_on date NOT NULL,
  reopened_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_closure_dates_valid CHECK (reopened_on IS NULL OR reopened_on > closed_on),
  CONSTRAINT company_closure_no_overlap EXCLUDE USING gist (
    company_id WITH =,
    daterange(closed_on, reopened_on, '[)') WITH &&
  )
);

CREATE INDEX company_closure_periods_company_idx ON public.company_closure_periods(company_id);

GRANT SELECT ON public.company_closure_periods TO authenticated;
GRANT ALL ON public.company_closure_periods TO service_role;

ALTER TABLE public.company_closure_periods ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_company(_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = _company_id
      AND (
        (c.organization_id IS NULL AND c.user_id = auth.uid())
        OR c.organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
      )
  )
$$;

CREATE POLICY "Company members can view closure periods"
ON public.company_closure_periods FOR SELECT TO authenticated
USING (public.can_access_company(company_id));

CREATE TRIGGER update_company_closure_periods_updated_at
BEFORE UPDATE ON public.company_closure_periods
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Close: opens a new closure period. Rejects if one is already open or dates overlap.
CREATE OR REPLACE FUNCTION public.close_company(_company_id uuid, _closed_on date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _co record; _id uuid;
BEGIN
  IF _closed_on IS NULL THEN RAISE EXCEPTION 'Closure date is required'; END IF;
  IF NOT public.can_access_company(_company_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO _co FROM public.companies WHERE id = _company_id;
  IF _co.archived_at IS NOT NULL OR _co.merged_into_company_id IS NOT NULL THEN
    RAISE EXCEPTION 'This company was archived or merged and cannot be closed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_closure_periods WHERE company_id = _company_id AND reopened_on IS NULL) THEN
    RAISE EXCEPTION 'This company is already closed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_closure_periods WHERE company_id = _company_id AND reopened_on > _closed_on) THEN
    RAISE EXCEPTION 'Closure date must be after the company''s most recent reopening';
  END IF;
  INSERT INTO public.company_closure_periods (company_id, user_id, organization_id, closed_on)
  VALUES (_company_id, auth.uid(), _co.organization_id, _closed_on)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- Reopen: ends the open closure period. Settings are never touched.
CREATE OR REPLACE FUNCTION public.reopen_company(_company_id uuid, _reopened_on date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _p record;
BEGIN
  IF _reopened_on IS NULL THEN RAISE EXCEPTION 'Reopen date is required'; END IF;
  IF NOT public.can_access_company(_company_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO _p FROM public.company_closure_periods
   WHERE company_id = _company_id AND reopened_on IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This company is not closed'; END IF;
  IF _reopened_on <= _p.closed_on THEN
    RAISE EXCEPTION 'Reopen date must be after the closure date';
  END IF;
  UPDATE public.company_closure_periods SET reopened_on = _reopened_on WHERE id = _p.id;
  RETURN _p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_company(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_company(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_company(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_company(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_company(uuid) TO authenticated;