ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL;