
-- 1. Hard-delete existing soft-deleted rows (artifacts from old link flow)
DELETE FROM public.transactions WHERE is_deleted = true;

-- 2. Tombstones for user-deleted Plaid transactions (prevents resurrection on resync)
CREATE TABLE public.plaid_deleted_tombstones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  plaid_transaction_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT DEFAULT 'user_deleted',
  UNIQUE (user_id, plaid_transaction_id)
);

CREATE INDEX idx_plaid_tombstones_user ON public.plaid_deleted_tombstones(user_id);
CREATE INDEX idx_plaid_tombstones_lookup ON public.plaid_deleted_tombstones(user_id, plaid_transaction_id);

ALTER TABLE public.plaid_deleted_tombstones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own tombstones" ON public.plaid_deleted_tombstones
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR organization_id IN (SELECT public.get_user_org_ids(auth.uid())));

CREATE POLICY "Users insert own tombstones" ON public.plaid_deleted_tombstones
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own tombstones" ON public.plaid_deleted_tombstones
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 3. Prevent duplicate Plaid-linked transactions per user
CREATE UNIQUE INDEX uq_transactions_user_plaid_ref
  ON public.transactions(user_id, plaid_transaction_ref)
  WHERE plaid_transaction_ref IS NOT NULL;

-- 4. Drop legacy soft-delete column (we hard-delete now)
ALTER TABLE public.transactions DROP COLUMN is_deleted;
