-- ============================================================================
-- TEST-ONLY bootstrap for the native PostgreSQL expense auto-link suite.
--
-- This file is NOT a production migration and is never applied to the app
-- database. It recreates only the minimum surface the real auto-link
-- migrations need (roles, auth.uid(), transactions, transaction_links,
-- organization_members, get_user_org_ids) plus the SAME grants and RLS
-- policies production uses, so the real migrations can then be applied
-- verbatim on top.
--
-- Nothing here weakens RLS, ownership checks, triggers or uniqueness: the
-- policies below mirror `pg_policies` for public.transactions /
-- public.transaction_links in production.
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Same contract as Supabase: the current user id comes from the request JWT
-- claims set on the session (`request.jwt.claims`).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  owner_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE OR REPLACE FUNCTION public.get_user_org_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT organization_id FROM public.organization_members WHERE user_id = _user_id
$$;

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  transaction_date date NOT NULL,
  vendor text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  account_source text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  notes text,
  receipt_url text,
  entity text NOT NULL DEFAULT '',
  company_type text NOT NULL DEFAULT '',
  source_id uuid,
  schedule_c_category text,
  transaction_type text NOT NULL DEFAULT 'expense',
  source_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'active',
  match_status text NOT NULL DEFAULT 'unmatched',
  linked_group_id uuid,
  plaid_transaction_ref uuid,
  linked_plaid_transaction_id uuid,
  linked_plaid_amount numeric,
  linked_plaid_posted_date date,
  linked_plaid_account text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transaction_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  linked_group_id uuid NOT NULL,
  manual_transaction_id uuid,
  plaid_transaction_record_id uuid,
  status text NOT NULL DEFAULT 'linked',
  confidence_score numeric,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_by_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  field_locks jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Production grants (Data API roles).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_links TO authenticated;
GRANT SELECT ON public.organizations, public.organization_members TO authenticated;
GRANT ALL ON public.transactions, public.transaction_links, public.organizations, public.organization_members TO service_role;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- transactions: org membership OR owner fallback for org-less rows (mirrors prod).
CREATE POLICY "Users can view org transactions" ON public.transactions FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org transactions" ON public.transactions FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org transactions" ON public.transactions FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Owner fallback select transactions" ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update transactions" ON public.transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete transactions" ON public.transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Users manage own links" ON public.transaction_links FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Members read organizations" ON public.organizations FOR SELECT TO authenticated
  USING (id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Members read memberships" ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
