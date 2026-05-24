ALTER TABLE public.ytd_catchup_entries
  ADD COLUMN IF NOT EXISTS business_expenses numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.validate_ytd_catchup_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.period_end < NEW.period_start THEN
    RAISE EXCEPTION 'period_end cannot be before period_start';
  END IF;
  IF NEW.gross_income < 0 THEN
    RAISE EXCEPTION 'gross_income cannot be negative';
  END IF;
  IF NEW.federal_withholding < 0 OR NEW.state_withholding < 0
     OR NEW.ss_withholding < 0 OR NEW.medicare_withholding < 0
     OR NEW.retirement_401k < 0 OR NEW.hsa_contribution < 0
     OR NEW.healthcare_premiums < 0 OR NEW.dental_vision < 0
     OR NEW.other_pretax < 0 OR NEW.post_tax_deductions < 0
     OR NEW.business_expenses < 0 THEN
    RAISE EXCEPTION 'withholdings and deductions cannot be negative';
  END IF;
  RETURN NEW;
END;
$$;