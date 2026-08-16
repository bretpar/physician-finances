ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS current_extra_w4_withholding numeric NOT NULL DEFAULT 0;