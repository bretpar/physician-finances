
-- Drop the incorrect FK referencing plaid_transactions
ALTER TABLE public.transaction_links
  DROP CONSTRAINT IF EXISTS transaction_links_plaid_transaction_record_id_fkey;

-- Add correct FK referencing transactions table
ALTER TABLE public.transaction_links
  ADD CONSTRAINT transaction_links_plaid_transaction_record_id_fkey
  FOREIGN KEY (plaid_transaction_record_id) REFERENCES public.transactions(id) ON DELETE SET NULL;
