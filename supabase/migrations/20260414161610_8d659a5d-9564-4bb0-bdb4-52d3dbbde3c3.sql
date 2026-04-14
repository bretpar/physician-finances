
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_from_reports boolean NOT NULL DEFAULT false;

CREATE INDEX idx_transactions_needs_review ON public.transactions(needs_review) WHERE needs_review = true;
