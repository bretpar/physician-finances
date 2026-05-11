ALTER TABLE public.investment_income_entries
ADD COLUMN IF NOT EXISTS is_qualified_dividend boolean NOT NULL DEFAULT true;