ALTER TABLE public.transactions
  ADD COLUMN actual_withholding numeric NOT NULL DEFAULT 0;