
-- Projected income streams
CREATE TABLE public.projected_income_streams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  company TEXT NOT NULL DEFAULT '',
  company_type TEXT NOT NULL DEFAULT 'W2',
  pay_frequency TEXT NOT NULL DEFAULT 'biweekly',
  custom_interval_days INTEGER,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  paycheck_amount NUMERIC NOT NULL DEFAULT 0,
  taxes_withheld NUMERIC NOT NULL DEFAULT 0,
  retirement_401k NUMERIC NOT NULL DEFAULT 0,
  pre_tax_deductions NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  include_in_tax BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projected_income_streams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org projected streams" ON public.projected_income_streams FOR SELECT TO authenticated USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org projected streams" ON public.projected_income_streams FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org projected streams" ON public.projected_income_streams FOR UPDATE TO authenticated USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org projected streams" ON public.projected_income_streams FOR DELETE TO authenticated USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_projected_income_streams_updated_at BEFORE UPDATE ON public.projected_income_streams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Bonus events
CREATE TABLE public.projected_bonus_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stream_id UUID NOT NULL REFERENCES public.projected_income_streams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  name TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  taxes_withheld NUMERIC NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'one-time',
  scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projected_bonus_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org bonus events" ON public.projected_bonus_events FOR SELECT TO authenticated USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org bonus events" ON public.projected_bonus_events FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org bonus events" ON public.projected_bonus_events FOR UPDATE TO authenticated USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org bonus events" ON public.projected_bonus_events FOR DELETE TO authenticated USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_projected_bonus_events_updated_at BEFORE UPDATE ON public.projected_bonus_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
