ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS schedule_c_category text;

CREATE INDEX IF NOT EXISTS idx_transactions_schedule_c_category
ON public.transactions(schedule_c_category)
WHERE schedule_c_category IS NOT NULL;