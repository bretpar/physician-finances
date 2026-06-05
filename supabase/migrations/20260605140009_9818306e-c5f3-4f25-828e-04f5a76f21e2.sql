
ALTER TABLE public.plaid_transactions
  ADD COLUMN IF NOT EXISTS dedupe_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plaid_transactions_user_fingerprint
  ON public.plaid_transactions (user_id, dedupe_fingerprint)
  WHERE dedupe_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plaid_transactions_user
  ON public.plaid_transactions (user_id);
