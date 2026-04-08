
CREATE TABLE public.income_forecasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  month TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  company_type TEXT NOT NULL DEFAULT '1099',
  gross_income NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_withholding NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.income_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own forecasts"
ON public.income_forecasts FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own forecasts"
ON public.income_forecasts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own forecasts"
ON public.income_forecasts FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own forecasts"
ON public.income_forecasts FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_income_forecasts_user_month ON public.income_forecasts (user_id, month);

CREATE TRIGGER update_income_forecasts_updated_at
BEFORE UPDATE ON public.income_forecasts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
