-- Relax income_entries.income_type check constraint to canonical 4 values
-- while still accepting legacy values that may exist in historical rows.
ALTER TABLE public.income_entries
  DROP CONSTRAINT IF EXISTS income_entries_income_type_check;

ALTER TABLE public.income_entries
  ADD CONSTRAINT income_entries_income_type_check
  CHECK (income_type IN (
    -- Canonical values used by all new saves
    'w2', '1099', 'k1', 'other',
    -- Legacy values preserved for historical rows / backward compatibility
    '1099_schedule_c', 'k1_partnership', 'scorp_w2', 'scorp_distribution',
    'w2_user', 'w2_partner',
    'short_term_gain', 'long_term_gain',
    'dividend', 'interest', 'rental', 'other_income', 'loss'
  ));