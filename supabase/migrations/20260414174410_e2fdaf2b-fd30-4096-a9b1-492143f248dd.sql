
ALTER TABLE public.plaid_accounts
  ADD COLUMN default_company_id uuid DEFAULT NULL,
  ADD COLUMN account_business_mode text NOT NULL DEFAULT 'unassigned';

ALTER TABLE public.transactions
  ADD COLUMN assignment_source text NOT NULL DEFAULT 'none';
