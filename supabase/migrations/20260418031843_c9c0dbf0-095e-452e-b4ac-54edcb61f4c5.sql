
ALTER TABLE public.transaction_attachments
  DROP CONSTRAINT IF EXISTS transaction_attachments_transaction_id_fkey;
