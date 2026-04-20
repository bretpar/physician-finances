ALTER TABLE public.mileage_entries
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mileage_entries_company_id ON public.mileage_entries(company_id);

-- Backfill: link existing rows to a company in the same org with matching name
UPDATE public.mileage_entries m
SET company_id = c.id
FROM public.companies c
WHERE m.company_id IS NULL
  AND c.name = m.company_name
  AND (
    (m.organization_id IS NOT NULL AND c.organization_id = m.organization_id)
    OR (m.organization_id IS NULL AND c.user_id = m.user_id)
  );