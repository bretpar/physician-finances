
-- 1. Update plaid_items: add institution_id, status, last_synced_at
ALTER TABLE public.plaid_items
  ADD COLUMN IF NOT EXISTS institution_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;

-- 2. Create plaid_accounts table
CREATE TABLE public.plaid_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  plaid_item_id uuid NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  plaid_account_id text NOT NULL,
  account_name text NOT NULL DEFAULT '',
  account_mask text,
  account_type text NOT NULL DEFAULT '',
  account_subtype text,
  current_balance numeric,
  available_balance numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(plaid_account_id)
);

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org plaid accounts" ON public.plaid_accounts
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org plaid accounts" ON public.plaid_accounts
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org plaid accounts" ON public.plaid_accounts
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org plaid accounts" ON public.plaid_accounts
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_plaid_accounts_updated_at
  BEFORE UPDATE ON public.plaid_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Create plaid_transactions table
CREATE TABLE public.plaid_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  plaid_transaction_id text NOT NULL,
  plaid_account_id text NOT NULL,
  date date NOT NULL,
  authorized_date date,
  name text NOT NULL DEFAULT '',
  merchant_name text,
  amount numeric NOT NULL DEFAULT 0,
  iso_currency_code text DEFAULT 'USD',
  unofficial_currency_code text,
  category_raw text,
  pending boolean NOT NULL DEFAULT false,
  payment_channel text,
  raw_json jsonb,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(plaid_transaction_id)
);

ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org plaid transactions" ON public.plaid_transactions
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org plaid transactions" ON public.plaid_transactions
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org plaid transactions" ON public.plaid_transactions
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org plaid transactions" ON public.plaid_transactions
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_plaid_transactions_updated_at
  BEFORE UPDATE ON public.plaid_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Update transactions table: add source/linking columns
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS plaid_transaction_ref uuid,
  ADD COLUMN IF NOT EXISTS linked_group_id uuid,
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'unmatched';

-- 5. Create transaction_links table
CREATE TABLE public.transaction_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  linked_group_id uuid NOT NULL,
  manual_transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE,
  plaid_transaction_record_id uuid REFERENCES public.plaid_transactions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'linked',
  confidence_score numeric,
  linked_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by_user boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.transaction_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org transaction links" ON public.transaction_links
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org transaction links" ON public.transaction_links
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can update org transaction links" ON public.transaction_links
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org transaction links" ON public.transaction_links
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE TRIGGER update_transaction_links_updated_at
  BEFORE UPDATE ON public.transaction_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Create transaction_match_ignores table
CREATE TABLE public.transaction_match_ignores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  manual_transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE,
  plaid_transaction_record_id uuid REFERENCES public.plaid_transactions(id) ON DELETE CASCADE,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.transaction_match_ignores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org match ignores" ON public.transaction_match_ignores
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org match ignores" ON public.transaction_match_ignores
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can delete org match ignores" ON public.transaction_match_ignores
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

-- Indexes for performance
CREATE INDEX idx_plaid_transactions_account ON public.plaid_transactions(plaid_account_id);
CREATE INDEX idx_plaid_transactions_date ON public.plaid_transactions(date);
CREATE INDEX idx_plaid_accounts_item ON public.plaid_accounts(plaid_item_id);
CREATE INDEX idx_transactions_source_type ON public.transactions(source_type);
CREATE INDEX idx_transactions_match_status ON public.transactions(match_status);
CREATE INDEX idx_transactions_linked_group ON public.transactions(linked_group_id);
CREATE INDEX idx_transaction_links_group ON public.transaction_links(linked_group_id);
