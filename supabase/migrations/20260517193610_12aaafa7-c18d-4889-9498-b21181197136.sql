ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS pay_frequency TEXT,
  ADD COLUMN IF NOT EXISTS remaining_paychecks_override INTEGER;