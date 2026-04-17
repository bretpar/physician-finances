ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS nickname text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS default_setaside_method text NOT NULL DEFAULT 'recommended',
  ADD COLUMN IF NOT EXISTS default_setaside_pct numeric,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';