-- 1. Settings: per-user toggle for auto-conversion
ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS auto_convert_future_income_to_ledger boolean NOT NULL DEFAULT false;

-- 2. Track converted occurrences (one row per stream+date or bonus_id once converted)
CREATE TABLE IF NOT EXISTS public.planner_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  stream_id uuid REFERENCES public.projected_income_streams(id) ON DELETE CASCADE,
  bonus_event_id uuid REFERENCES public.projected_bonus_events(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  -- Destination: which ledger and which row was created
  ledger_bucket text NOT NULL,                        -- 'personal' | 'business'
  income_entry_id uuid,                               -- when ledger_bucket = 'personal'
  transaction_id uuid,                                -- when ledger_bucket = 'business'
  status text NOT NULL DEFAULT 'converted',           -- 'converted' | 'duplicate_skipped' | 'cancelled'
  needs_review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Prevent re-conversion of the same paycheck occurrence
  CONSTRAINT planner_conversions_unique_stream_occurrence
    UNIQUE NULLS NOT DISTINCT (stream_id, occurrence_date),
  CONSTRAINT planner_conversions_unique_bonus
    UNIQUE NULLS NOT DISTINCT (bonus_event_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_conversions_user
  ON public.planner_conversions(user_id);
CREATE INDEX IF NOT EXISTS idx_planner_conversions_org
  ON public.planner_conversions(organization_id);
CREATE INDEX IF NOT EXISTS idx_planner_conversions_income_entry
  ON public.planner_conversions(income_entry_id);
CREATE INDEX IF NOT EXISTS idx_planner_conversions_transaction
  ON public.planner_conversions(transaction_id);

ALTER TABLE public.planner_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner fallback select planner_conversions"
  ON public.planner_conversions FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Owner fallback insert planner_conversions"
  ON public.planner_conversions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Owner fallback update planner_conversions"
  ON public.planner_conversions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Owner fallback delete planner_conversions"
  ON public.planner_conversions FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Users can view org planner_conversions"
  ON public.planner_conversions FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org planner_conversions"
  ON public.planner_conversions FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org planner_conversions"
  ON public.planner_conversions FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org planner_conversions"
  ON public.planner_conversions FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE TRIGGER planner_conversions_set_updated_at
  BEFORE UPDATE ON public.planner_conversions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Origin tracking on existing ledger tables (NULL-safe additions)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS origin_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS origin_planner_conversion_id uuid REFERENCES public.planner_conversions(id) ON DELETE SET NULL;

ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS origin_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS origin_planner_conversion_id uuid REFERENCES public.planner_conversions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_origin_type ON public.transactions(origin_type);
CREATE INDEX IF NOT EXISTS idx_income_entries_origin_type ON public.income_entries(origin_type);
