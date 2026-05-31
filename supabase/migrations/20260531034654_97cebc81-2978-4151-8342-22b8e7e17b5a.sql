ALTER TABLE public.ytd_catchup_entries
  ADD COLUMN IF NOT EXISTS owner_person text NOT NULL DEFAULT 'taxpayer';

ALTER TABLE public.ytd_catchup_entries
  DROP CONSTRAINT IF EXISTS ytd_catchup_owner_person_check;

ALTER TABLE public.ytd_catchup_entries
  ADD CONSTRAINT ytd_catchup_owner_person_check
  CHECK (owner_person IN ('taxpayer','spouse'));