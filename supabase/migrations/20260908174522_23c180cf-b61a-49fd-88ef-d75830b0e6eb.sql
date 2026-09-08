ALTER TABLE public.retirement_contributions
  ADD COLUMN IF NOT EXISTS contribution_date date;

UPDATE public.retirement_contributions
SET contribution_date = start_date
WHERE contribution_date IS NULL;