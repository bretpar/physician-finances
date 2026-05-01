ALTER TABLE public.projected_income_overrides
  ADD COLUMN IF NOT EXISTS new_date date NULL;

COMMENT ON COLUMN public.projected_income_overrides.new_date IS
  'Optional. When set on a "modify" override, the projected occurrence is rendered on this date instead of override_date. override_date remains the anchor (the original scheduled occurrence being modified).';