
-- ============================================================
-- Many-to-many transaction matching: groups + items
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transaction_match_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  status text NOT NULL DEFAULT 'active',
  manual_total numeric NOT NULL DEFAULT 0,
  imported_total numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transaction_match_groups ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tmg_user ON public.transaction_match_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_tmg_org ON public.transaction_match_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_tmg_status ON public.transaction_match_groups(status);

CREATE TRIGGER trg_tmg_updated_at
  BEFORE UPDATE ON public.transaction_match_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Owner fallback select tmg" ON public.transaction_match_groups
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert tmg" ON public.transaction_match_groups
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update tmg" ON public.transaction_match_groups
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete tmg" ON public.transaction_match_groups
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Users can view org tmg" ON public.transaction_match_groups
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org tmg" ON public.transaction_match_groups
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org tmg" ON public.transaction_match_groups
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org tmg" ON public.transaction_match_groups
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));


CREATE TABLE IF NOT EXISTS public.transaction_match_group_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_group_id uuid NOT NULL REFERENCES public.transaction_match_groups(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL,
  transaction_source text NOT NULL CHECK (transaction_source IN ('manual','imported')),
  user_id uuid NOT NULL,
  organization_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transaction_match_group_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tmgi_group ON public.transaction_match_group_items(match_group_id);
CREATE INDEX IF NOT EXISTS idx_tmgi_tx ON public.transaction_match_group_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tmgi_user ON public.transaction_match_group_items(user_id);

-- Enforce: a transaction may belong to only one ACTIVE matched group.
CREATE OR REPLACE FUNCTION public.enforce_single_active_match_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_conflict uuid;
BEGIN
  SELECT status INTO v_status FROM public.transaction_match_groups WHERE id = NEW.match_group_id;
  IF v_status IS NULL OR v_status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT i.match_group_id INTO v_conflict
    FROM public.transaction_match_group_items i
    JOIN public.transaction_match_groups g ON g.id = i.match_group_id
   WHERE i.transaction_id = NEW.transaction_id
     AND g.status = 'active'
     AND i.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction % is already in an active matched group %', NEW.transaction_id, v_conflict;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tmgi_single_active
  BEFORE INSERT OR UPDATE ON public.transaction_match_group_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_active_match_group();

CREATE POLICY "Owner fallback select tmgi" ON public.transaction_match_group_items
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert tmgi" ON public.transaction_match_group_items
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update tmgi" ON public.transaction_match_group_items
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete tmgi" ON public.transaction_match_group_items
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND organization_id IS NULL);

CREATE POLICY "Users can view org tmgi" ON public.transaction_match_group_items
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can create org tmgi" ON public.transaction_match_group_items
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can update org tmgi" ON public.transaction_match_group_items
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));
CREATE POLICY "Users can delete org tmgi" ON public.transaction_match_group_items
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.get_user_org_ids(auth.uid())));


-- ============================================================
-- Backfill existing 1:1 transaction_links into match groups
-- ============================================================
DO $$
DECLARE
  r record;
  v_manual_amt numeric;
  v_imported_amt numeric;
BEGIN
  FOR r IN
    SELECT tl.linked_group_id, tl.user_id, tl.organization_id,
           tl.manual_transaction_id, tl.plaid_transaction_record_id
      FROM public.transaction_links tl
     WHERE tl.status = 'linked'
       AND tl.linked_group_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.transaction_match_groups g WHERE g.id = tl.linked_group_id
       )
  LOOP
    SELECT COALESCE(amount,0) INTO v_manual_amt FROM public.transactions WHERE id = r.manual_transaction_id;
    SELECT COALESCE(amount,0) INTO v_imported_amt FROM public.transactions WHERE id = r.plaid_transaction_record_id;
    v_manual_amt := COALESCE(v_manual_amt, 0);
    v_imported_amt := COALESCE(v_imported_amt, 0);

    INSERT INTO public.transaction_match_groups (id, user_id, organization_id, status, manual_total, imported_total, difference)
    VALUES (r.linked_group_id, r.user_id, r.organization_id, 'active', v_manual_amt, v_imported_amt, v_manual_amt - v_imported_amt);

    IF r.manual_transaction_id IS NOT NULL THEN
      INSERT INTO public.transaction_match_group_items (match_group_id, transaction_id, transaction_source, user_id, organization_id)
      VALUES (r.linked_group_id, r.manual_transaction_id, 'manual', r.user_id, r.organization_id)
      ON CONFLICT DO NOTHING;
    END IF;
    IF r.plaid_transaction_record_id IS NOT NULL THEN
      INSERT INTO public.transaction_match_group_items (match_group_id, transaction_id, transaction_source, user_id, organization_id)
      VALUES (r.linked_group_id, r.plaid_transaction_record_id, 'imported', r.user_id, r.organization_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
