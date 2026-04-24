-- Add applied_quarter and applied_tax_year to tax_payments to separate
-- the actual payment date from the tax quarter the payment satisfies.

ALTER TABLE public.tax_payments
  ADD COLUMN IF NOT EXISTS applied_quarter text,
  ADD COLUMN IF NOT EXISTS applied_tax_year integer;

-- Backfill applied_quarter from existing `quarter` column
UPDATE public.tax_payments
SET applied_quarter = COALESCE(NULLIF(quarter, ''), 'Q1')
WHERE applied_quarter IS NULL;

-- Backfill applied_tax_year by inferring from payment_date.
-- Q1 payments often happen Jan-Apr (deadline Apr 15) -> tax year = year of payment
-- Q4 payments often happen in Jan of following year (deadline Jan 15) -> tax year = year - 1
-- For simplicity, infer from payment_date year, then adjust Q4 January payments back one year.
UPDATE public.tax_payments
SET applied_tax_year = CASE
  WHEN applied_quarter = 'Q4' AND EXTRACT(MONTH FROM payment_date) = 1
    THEN EXTRACT(YEAR FROM payment_date)::int - 1
  ELSE EXTRACT(YEAR FROM payment_date)::int
END
WHERE applied_tax_year IS NULL;

-- Set NOT NULL with sensible defaults going forward
ALTER TABLE public.tax_payments
  ALTER COLUMN applied_quarter SET DEFAULT 'Q1',
  ALTER COLUMN applied_quarter SET NOT NULL,
  ALTER COLUMN applied_tax_year SET DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::int,
  ALTER COLUMN applied_tax_year SET NOT NULL;

-- Constrain quarter values
ALTER TABLE public.tax_payments
  DROP CONSTRAINT IF EXISTS tax_payments_applied_quarter_check;
ALTER TABLE public.tax_payments
  ADD CONSTRAINT tax_payments_applied_quarter_check
  CHECK (applied_quarter IN ('Q1','Q2','Q3','Q4'));

CREATE INDEX IF NOT EXISTS idx_tax_payments_applied_period
  ON public.tax_payments (applied_tax_year, applied_quarter);
