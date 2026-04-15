
-- Add account_routing column
ALTER TABLE public.plaid_accounts
ADD COLUMN account_routing text NOT NULL DEFAULT 'needs_review';

-- Migrate existing data: accounts with a business assignment → business
UPDATE public.plaid_accounts
SET account_routing = 'business'
WHERE account_business_mode IN ('single_business', 'shared');

-- Accounts with sync disabled → ignore
UPDATE public.plaid_accounts
SET account_routing = 'ignore'
WHERE sync_enabled = false AND account_routing = 'needs_review';
