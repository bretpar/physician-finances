ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS linked_ytd_catchup_id uuid;

CREATE INDEX IF NOT EXISTS idx_income_entries_linked_ytd_catchup_id
  ON public.income_entries (linked_ytd_catchup_id)
  WHERE linked_ytd_catchup_id IS NOT NULL;