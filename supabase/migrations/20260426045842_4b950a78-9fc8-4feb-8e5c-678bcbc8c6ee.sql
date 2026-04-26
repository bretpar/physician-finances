CREATE TABLE public.home_office_deductions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NULL,
  company_id UUID NULL,
  deduction_type TEXT NOT NULL DEFAULT 'home_office',
  include_in_tax_calculation BOOLEAN NOT NULL DEFAULT false,
  method TEXT NOT NULL DEFAULT 'simplified_square_footage',
  square_feet NUMERIC NULL,
  prior_year_amount NUMERIC NULL,
  calculated_amount NUMERIC NOT NULL DEFAULT 0,
  allowed_amount NUMERIC NOT NULL DEFAULT 0,
  unused_capped_amount NUMERIC NOT NULL DEFAULT 0,
  tax_year INTEGER NOT NULL DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT home_office_deductions_deduction_type_check CHECK (deduction_type = 'home_office'),
  CONSTRAINT home_office_deductions_method_check CHECK (method IN ('simplified_square_footage', 'prior_year_estimate')),
  CONSTRAINT home_office_deductions_status_check CHECK (status IN ('active', 'deleted')),
  CONSTRAINT home_office_deductions_nonnegative_check CHECK (
    COALESCE(square_feet, 0) >= 0
    AND COALESCE(prior_year_amount, 0) >= 0
    AND calculated_amount >= 0
    AND allowed_amount >= 0
    AND unused_capped_amount >= 0
  )
);

CREATE UNIQUE INDEX home_office_deductions_one_active_per_company_year
ON public.home_office_deductions (user_id, company_id, tax_year)
WHERE status = 'active' AND company_id IS NOT NULL;

CREATE INDEX idx_home_office_deductions_user_year
ON public.home_office_deductions (user_id, tax_year);

CREATE INDEX idx_home_office_deductions_company_year
ON public.home_office_deductions (company_id, tax_year);

ALTER TABLE public.home_office_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner fallback view home office deductions"
ON public.home_office_deductions
FOR SELECT
TO authenticated
USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback create home office deductions"
ON public.home_office_deductions
FOR INSERT
TO authenticated
WITH CHECK ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback update home office deductions"
ON public.home_office_deductions
FOR UPDATE
TO authenticated
USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Owner fallback delete home office deductions"
ON public.home_office_deductions
FOR DELETE
TO authenticated
USING ((auth.uid() = user_id) AND (organization_id IS NULL));

CREATE POLICY "Users can view org home office deductions"
ON public.home_office_deductions
FOR SELECT
TO authenticated
USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org home office deductions"
ON public.home_office_deductions
FOR INSERT
TO authenticated
WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org home office deductions"
ON public.home_office_deductions
FOR UPDATE
TO authenticated
USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org home office deductions"
ON public.home_office_deductions
FOR DELETE
TO authenticated
USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE TRIGGER update_home_office_deductions_updated_at
BEFORE UPDATE ON public.home_office_deductions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();