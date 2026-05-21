-- 1) needs_review column on income_entries
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

-- Backfill: existing planner-converted entries become "needs review"
UPDATE public.income_entries
SET needs_review = true
WHERE origin_type = 'planner_converted'
  AND needs_review = false;

-- 2) income_entry_links: parallel to transaction_links, scoped to income_entries
CREATE TABLE IF NOT EXISTS public.income_entry_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid,
  linked_group_id uuid NOT NULL,
  canonical_entry_id uuid NOT NULL,
  merged_entry_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'linked',
  created_by_user boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_income_entry_links_group ON public.income_entry_links(linked_group_id);
CREATE INDEX IF NOT EXISTS idx_income_entry_links_canon ON public.income_entry_links(canonical_entry_id);
CREATE INDEX IF NOT EXISTS idx_income_entry_links_merged ON public.income_entry_links(merged_entry_id);

ALTER TABLE public.income_entry_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own income_entry_links" ON public.income_entry_links;
CREATE POLICY "Users can view own income_entry_links"
ON public.income_entry_links FOR SELECT TO authenticated
USING (
  (auth.uid() = user_id AND organization_id IS NULL)
  OR (organization_id IN (SELECT get_user_org_ids(auth.uid())))
);

DROP POLICY IF EXISTS "Users can insert own income_entry_links" ON public.income_entry_links;
CREATE POLICY "Users can insert own income_entry_links"
ON public.income_entry_links FOR INSERT TO authenticated
WITH CHECK (
  (auth.uid() = user_id AND organization_id IS NULL)
  OR (organization_id IN (SELECT get_user_org_ids(auth.uid())))
);

DROP POLICY IF EXISTS "Users can update own income_entry_links" ON public.income_entry_links;
CREATE POLICY "Users can update own income_entry_links"
ON public.income_entry_links FOR UPDATE TO authenticated
USING (
  (auth.uid() = user_id AND organization_id IS NULL)
  OR (organization_id IN (SELECT get_user_org_ids(auth.uid())))
);

DROP POLICY IF EXISTS "Users can delete own income_entry_links" ON public.income_entry_links;
CREATE POLICY "Users can delete own income_entry_links"
ON public.income_entry_links FOR DELETE TO authenticated
USING (
  (auth.uid() = user_id AND organization_id IS NULL)
  OR (organization_id IN (SELECT get_user_org_ids(auth.uid())))
);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_income_entry_links_updated_at ON public.income_entry_links;
CREATE TRIGGER trg_income_entry_links_updated_at
BEFORE UPDATE ON public.income_entry_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- enforce user_id immutability + match-auth-uid (same as other user tables)
DROP TRIGGER IF EXISTS trg_income_entry_links_enforce_user ON public.income_entry_links;
CREATE TRIGGER trg_income_entry_links_enforce_user
BEFORE INSERT OR UPDATE ON public.income_entry_links
FOR EACH ROW EXECUTE FUNCTION public.enforce_user_id_matches_auth();