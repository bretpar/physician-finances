-- 1. Add source_kind to companies (text with sensible default)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT '1099_schedule_c';

-- Backfill source_kind from existing company_type where possible
UPDATE public.companies
SET source_kind = CASE
  WHEN company_type ILIKE 'w2%' OR company_type ILIKE 'w-2%' THEN 'w2_employer'
  WHEN company_type ILIKE '%personal%' THEN 'personal'
  WHEN company_type ILIKE '%k1%' OR company_type ILIKE '%k-1%' OR company_type ILIKE '%partnership%' THEN 'k1_partnership'
  WHEN company_type ILIKE '%scorp%' OR company_type ILIKE '%s_corp%' OR company_type ILIKE '%s-corp%' THEN 's_corp'
  WHEN company_type ILIKE '%1099%' OR company_type ILIKE '%schedule_c%' THEN '1099_schedule_c'
  ELSE 'other_business'
END
WHERE source_kind = '1099_schedule_c';

-- 2. Add source_id link columns
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS source_id uuid NULL;

ALTER TABLE public.projected_income_streams
  ADD COLUMN IF NOT EXISTS source_id uuid NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_id uuid NULL;

-- 3. Indexes for fast joins/filters
CREATE INDEX IF NOT EXISTS idx_income_entries_source_id ON public.income_entries(source_id);
CREATE INDEX IF NOT EXISTS idx_projected_streams_source_id ON public.projected_income_streams(source_id);
CREATE INDEX IF NOT EXISTS idx_transactions_source_id ON public.transactions(source_id);
CREATE INDEX IF NOT EXISTS idx_companies_source_kind ON public.companies(source_kind);