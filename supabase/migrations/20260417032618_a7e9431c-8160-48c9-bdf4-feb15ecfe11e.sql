-- Backfill companies
UPDATE public.companies SET company_type = '1099_schedule_c' WHERE company_type = '1099';
UPDATE public.companies SET company_type = 'w2' WHERE company_type IN ('W2','w2_user','w2_partner');
UPDATE public.companies SET company_type = 'k1_partnership' WHERE company_type = 'K1';

-- Backfill income_entries
UPDATE public.income_entries SET income_type = '1099_schedule_c' WHERE income_type = '1099';
UPDATE public.income_entries SET income_type = 'w2' WHERE income_type IN ('W2','w2_user','w2_partner');
UPDATE public.income_entries SET income_type = 'k1_partnership' WHERE income_type = 'K1';

-- Normalize transactions.company_type for consistency
UPDATE public.transactions SET company_type = '1099_schedule_c' WHERE company_type = '1099';
UPDATE public.transactions SET company_type = 'w2' WHERE company_type IN ('W2','w2_user','w2_partner');
UPDATE public.transactions SET company_type = 'k1_partnership' WHERE company_type = 'K1';

-- Update defaults
ALTER TABLE public.companies ALTER COLUMN company_type SET DEFAULT '1099_schedule_c';
ALTER TABLE public.income_entries ALTER COLUMN income_type SET DEFAULT '1099_schedule_c';

-- CHECK constraints (allow empty string on transactions for legacy/unassigned)
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_company_type_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_company_type_check
  CHECK (company_type IN ('1099_schedule_c','k1_partnership','scorp_w2','scorp_distribution','w2','other'));

ALTER TABLE public.income_entries DROP CONSTRAINT IF EXISTS income_entries_income_type_check;
ALTER TABLE public.income_entries ADD CONSTRAINT income_entries_income_type_check
  CHECK (income_type IN ('1099_schedule_c','k1_partnership','scorp_w2','scorp_distribution','w2','other'));