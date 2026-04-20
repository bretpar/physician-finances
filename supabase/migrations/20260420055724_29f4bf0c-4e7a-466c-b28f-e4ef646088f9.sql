-- 1. Add status column (active = visible, duplicate/merged/archived = hidden from ledger)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- 2. Backfill any nulls just in case
UPDATE public.transactions SET status = 'active' WHERE status IS NULL;

-- 3. Restrict status to known values
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('active', 'duplicate', 'merged', 'archived'));

-- 4. FK from source_id (business assignment) -> companies.id
--    ON DELETE SET NULL so deleting a business doesn't nuke its transactions.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_source_id_fkey;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_source_id_fkey
  FOREIGN KEY (source_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- 5. Index for business ledger query (user + business + status + date)
CREATE INDEX IF NOT EXISTS idx_transactions_user_source_status_date
  ON public.transactions (user_id, source_id, status, transaction_date DESC, created_at DESC);
