CREATE TABLE public.quarter_dashboard_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID,
  tax_year INTEGER NOT NULL,
  quarter SMALLINT NOT NULL,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  frozen_quarter_target NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, tax_year, quarter)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quarter_dashboard_state TO authenticated;
GRANT ALL ON public.quarter_dashboard_state TO service_role;

ALTER TABLE public.quarter_dashboard_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own quarter dashboard state"
  ON public.quarter_dashboard_state FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER quarter_dashboard_state_updated_at
  BEFORE UPDATE ON public.quarter_dashboard_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER enforce_user_id_matches_auth_quarter_dashboard_state
  BEFORE INSERT OR UPDATE ON public.quarter_dashboard_state
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_id_matches_auth();