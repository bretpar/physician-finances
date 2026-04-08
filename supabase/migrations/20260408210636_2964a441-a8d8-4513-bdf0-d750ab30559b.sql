
-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'member');

-- 2. Organizations table
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  owner_user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 3. Organization members table
CREATE TABLE public.organization_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 4. Security definer functions (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.get_user_org_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_members WHERE user_id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_user_id UUID, _org_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin_or_owner(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role IN ('owner', 'admin')
  );
$$;

-- 5. RLS for organizations
CREATE POLICY "Users can view their own organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Owners can update their organization"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(auth.uid(), id, 'owner'));

-- 6. RLS for organization_members
CREATE POLICY "Members can view their org members"
  ON public.organization_members FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Admins/owners can insert org members"
  ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin_or_owner(auth.uid(), organization_id));

CREATE POLICY "Admins/owners can update org members"
  ON public.organization_members FOR UPDATE TO authenticated
  USING (public.is_org_admin_or_owner(auth.uid(), organization_id));

CREATE POLICY "Admins/owners can delete org members"
  ON public.organization_members FOR DELETE TO authenticated
  USING (public.is_org_admin_or_owner(auth.uid(), organization_id));

-- 7. Add organization_id to existing tables
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.income_forecasts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.tax_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.plaid_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.mileage_entries ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

-- 8. Update RLS on existing tables to also check organization membership
-- Drop old policies and recreate with org scoping

-- TRANSACTIONS
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can create their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.transactions;

CREATE POLICY "Users can view org transactions" ON public.transactions FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org transactions" ON public.transactions FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org transactions" ON public.transactions FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- COMPANIES
DROP POLICY IF EXISTS "Users can view their own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can insert their own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can update their own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can delete their own companies" ON public.companies;

CREATE POLICY "Users can view org companies" ON public.companies FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org companies" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org companies" ON public.companies FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org companies" ON public.companies FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- INCOME_FORECASTS
DROP POLICY IF EXISTS "Users can view their own forecasts" ON public.income_forecasts;
DROP POLICY IF EXISTS "Users can insert their own forecasts" ON public.income_forecasts;
DROP POLICY IF EXISTS "Users can update their own forecasts" ON public.income_forecasts;
DROP POLICY IF EXISTS "Users can delete their own forecasts" ON public.income_forecasts;

CREATE POLICY "Users can view org forecasts" ON public.income_forecasts FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org forecasts" ON public.income_forecasts FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org forecasts" ON public.income_forecasts FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org forecasts" ON public.income_forecasts FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- TAX_SETTINGS
DROP POLICY IF EXISTS "Users can view their own tax settings" ON public.tax_settings;
DROP POLICY IF EXISTS "Users can insert their own tax settings" ON public.tax_settings;
DROP POLICY IF EXISTS "Users can update their own tax settings" ON public.tax_settings;

CREATE POLICY "Users can view org tax settings" ON public.tax_settings FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org tax settings" ON public.tax_settings FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org tax settings" ON public.tax_settings FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- PROFILES
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can view org profiles" ON public.profiles FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- PLAID_ITEMS
DROP POLICY IF EXISTS "Users can view their own plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can insert their own plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can update their own plaid items" ON public.plaid_items;
DROP POLICY IF EXISTS "Users can delete their own plaid items" ON public.plaid_items;

CREATE POLICY "Users can view org plaid items" ON public.plaid_items FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org plaid items" ON public.plaid_items FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org plaid items" ON public.plaid_items FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org plaid items" ON public.plaid_items FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- MILEAGE_ENTRIES
DROP POLICY IF EXISTS "Users can view their own mileage entries" ON public.mileage_entries;
DROP POLICY IF EXISTS "Users can insert their own mileage entries" ON public.mileage_entries;
DROP POLICY IF EXISTS "Users can update their own mileage entries" ON public.mileage_entries;
DROP POLICY IF EXISTS "Users can delete their own mileage entries" ON public.mileage_entries;

CREATE POLICY "Users can view org mileage" ON public.mileage_entries FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org mileage" ON public.mileage_entries FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org mileage" ON public.mileage_entries FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org mileage" ON public.mileage_entries FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 9. Auto-provision trigger: create org + profile + membership on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create organization
  INSERT INTO public.organizations (name, owner_user_id)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.id)
  RETURNING id INTO new_org_id;

  -- Add as owner
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  -- Create profile
  INSERT INTO public.profiles (user_id, email, organization_id, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    new_org_id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );

  -- Create default tax settings
  INSERT INTO public.tax_settings (user_id, organization_id)
  VALUES (NEW.id, new_org_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 10. Timestamps triggers for new tables
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
