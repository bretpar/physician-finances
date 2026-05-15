ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS linked_plaid_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS linked_plaid_amount numeric,
  ADD COLUMN IF NOT EXISTS linked_plaid_posted_date date,
  ADD COLUMN IF NOT EXISTS linked_plaid_account text;