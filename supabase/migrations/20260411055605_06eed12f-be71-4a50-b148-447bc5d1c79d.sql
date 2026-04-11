ALTER TABLE public.transactions
  ADD COLUMN recommended_withholding numeric NOT NULL DEFAULT 0,
  ADD COLUMN withholding_saved boolean NOT NULL DEFAULT false;