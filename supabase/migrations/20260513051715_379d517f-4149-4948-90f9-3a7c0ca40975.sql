
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by_user uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_needs_review
  ON public.transactions(user_id, needs_review)
  WHERE needs_review = true;
