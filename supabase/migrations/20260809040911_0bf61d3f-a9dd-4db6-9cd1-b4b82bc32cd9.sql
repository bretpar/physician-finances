CREATE TABLE public.feature_access_overrides (
  feature_key text NOT NULL PRIMARY KEY,
  access_level text NOT NULL CHECK (access_level IN ('free','premium','premium_beta','developer','disabled')),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.feature_access_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_access_overrides TO authenticated;
GRANT ALL ON public.feature_access_overrides TO service_role;

ALTER TABLE public.feature_access_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read feature overrides"
ON public.feature_access_overrides FOR SELECT TO authenticated USING (true);

CREATE POLICY "Developers can insert feature overrides"
ON public.feature_access_overrides FOR INSERT TO authenticated
WITH CHECK (public.get_my_account_role() = 'developer');

CREATE POLICY "Developers can update feature overrides"
ON public.feature_access_overrides FOR UPDATE TO authenticated
USING (public.get_my_account_role() = 'developer')
WITH CHECK (public.get_my_account_role() = 'developer');

CREATE POLICY "Developers can delete feature overrides"
ON public.feature_access_overrides FOR DELETE TO authenticated
USING (public.get_my_account_role() = 'developer');

CREATE TRIGGER feature_access_overrides_updated_at
BEFORE UPDATE ON public.feature_access_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();