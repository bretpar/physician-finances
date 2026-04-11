
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS parent_transaction_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recurring_frequency text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;
