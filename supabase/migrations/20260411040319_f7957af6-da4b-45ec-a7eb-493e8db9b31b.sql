
-- Add status column with default 'received' so existing entries are correct
ALTER TABLE public.income_entries
ADD COLUMN status text NOT NULL DEFAULT 'received';

-- Add linked transaction reference
ALTER TABLE public.income_entries
ADD COLUMN linked_transaction_id uuid NULL;

-- Index for fast status filtering
CREATE INDEX idx_income_entries_status ON public.income_entries (status);

-- Index for date + status queries used in auto-transition logic
CREATE INDEX idx_income_entries_date_status ON public.income_entries (income_date, status);
