ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS fsa_health numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fsa_dependent_care numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fsa_limited_purpose numeric NOT NULL DEFAULT 0;