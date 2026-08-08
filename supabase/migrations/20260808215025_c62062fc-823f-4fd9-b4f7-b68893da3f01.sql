ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS employer_retirement_contribution numeric NOT NULL DEFAULT 0;