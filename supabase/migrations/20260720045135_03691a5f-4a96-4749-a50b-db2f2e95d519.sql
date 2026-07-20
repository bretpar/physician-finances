
-- Student Loan Estimator: settings toggle + loans table

ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS student_loan_estimator_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS student_loan_family_size integer,
  ADD COLUMN IF NOT EXISTS student_loan_income_override numeric,
  ADD COLUMN IF NOT EXISTS student_loan_spouse_income_override numeric,
  ADD COLUMN IF NOT EXISTS student_loan_community_property_override boolean;

CREATE TABLE IF NOT EXISTS public.student_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  loan_type text NOT NULL DEFAULT 'federal',
  balance numeric NOT NULL DEFAULT 0,
  interest_rate numeric NOT NULL DEFAULT 0,
  current_monthly_payment numeric,
  additional_monthly_payment numeric,
  months_in_repayment integer,
  repayment_plan text NOT NULL DEFAULT 'standard_10',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_loans TO authenticated;
GRANT ALL ON public.student_loans TO service_role;

ALTER TABLE public.student_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_loans_select_own" ON public.student_loans
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "student_loans_insert_own" ON public.student_loans
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "student_loans_update_own" ON public.student_loans
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "student_loans_delete_own" ON public.student_loans
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS student_loans_user_id_idx ON public.student_loans(user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_student_loans_updated_at ON public.student_loans;
CREATE TRIGGER update_student_loans_updated_at
  BEFORE UPDATE ON public.student_loans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
