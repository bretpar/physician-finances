
-- Create retirement contributions table
CREATE TABLE public.retirement_contributions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid NULL REFERENCES public.organizations(id),
  account_type text NOT NULL DEFAULT '401k',
  contribution_amount numeric NOT NULL DEFAULT 0,
  frequency text NOT NULL DEFAULT 'per_paycheck',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NULL,
  employer_match numeric NOT NULL DEFAULT 0,
  apply_to_withholding boolean NOT NULL DEFAULT true,
  notes text NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.retirement_contributions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view org retirement contributions"
ON public.retirement_contributions FOR SELECT TO authenticated
USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org retirement contributions"
ON public.retirement_contributions FOR INSERT TO authenticated
WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org retirement contributions"
ON public.retirement_contributions FOR UPDATE TO authenticated
USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org retirement contributions"
ON public.retirement_contributions FOR DELETE TO authenticated
USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

-- Updated_at trigger
CREATE TRIGGER update_retirement_contributions_updated_at
BEFORE UPDATE ON public.retirement_contributions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index
CREATE INDEX idx_retirement_contributions_org ON public.retirement_contributions (organization_id);
