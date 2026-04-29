ALTER TABLE public.transaction_match_ignores
  DROP CONSTRAINT IF EXISTS transaction_match_ignores_plaid_transaction_record_id_fkey;

ALTER TABLE public.transaction_match_ignores
  ADD CONSTRAINT transaction_match_ignores_plaid_transaction_record_id_fkey
  FOREIGN KEY (plaid_transaction_record_id) REFERENCES public.transactions(id) ON DELETE CASCADE;