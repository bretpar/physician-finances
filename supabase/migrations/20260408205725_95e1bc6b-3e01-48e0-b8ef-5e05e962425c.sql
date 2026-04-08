ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS entity text NOT NULL DEFAULT 'Unassigned',
  ADD COLUMN IF NOT EXISTS company_type text NOT NULL DEFAULT '';