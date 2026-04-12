

## Per-Date Overrides for Recurring Income Streams

**Problem**: Recurring streams generate identical paychecks on every date. Users need to skip, increase, or decrease the amount for specific dates (e.g., one paycheck in July is different or shouldn't exist).

**Approach**: Create a `projected_income_overrides` table that stores per-date exceptions. The projection engine checks this table when generating paychecks — if an override exists for a given stream+date, it either skips that date or uses the custom amount.

### 1. New database table: `projected_income_overrides`

```sql
CREATE TABLE public.projected_income_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL,
  user_id UUID NOT NULL,
  organization_id UUID,
  override_date DATE NOT NULL,
  action TEXT NOT NULL DEFAULT 'modify',  -- 'skip' or 'modify'
  paycheck_amount NUMERIC NOT NULL DEFAULT 0,
  taxes_withheld NUMERIC NOT NULL DEFAULT 0,
  retirement_401k NUMERIC NOT NULL DEFAULT 0,
  pre_tax_deductions NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stream_id, override_date)
);
```

RLS policies matching the org-based pattern used by all other tables. Enable `updated_at` trigger.

### 2. Hook changes (`src/hooks/useProjectedIncome.ts`)

- Add `useStreamOverrides(streamId?)` query hook
- Add `useAddOverride`, `useUpdateOverride`, `useDeleteOverride` mutation hooks
- Update `generateProjectedPaychecks` to accept overrides array; for each generated date, check if an override exists:
  - `action = 'skip'` → omit that paycheck entirely
  - `action = 'modify'` → use the override's amounts instead of the stream defaults

### 3. UI changes (`src/pages/ProjectedIncome.tsx`)

In the monthly expandable sections where individual projected paychecks are listed:

- Add an **Edit** (pencil) icon and a **Skip/Delete** (X) icon on each paycheck row
- **Skip**: Creates an override with `action = 'skip'` — the date disappears from projections and totals
- **Edit**: Opens a small dialog pre-filled with the stream's default amounts for that date. User can change amount, withholding, 401k, deductions. Saves as `action = 'modify'`
- Skipped dates shown with strikethrough styling and a "Restore" button
- Modified dates shown with a small badge indicating they differ from the stream default

### Files to change

| File | Change |
|------|--------|
| Migration | Create `projected_income_overrides` table with RLS |
| `src/hooks/useProjectedIncome.ts` | Add override query/mutations; update projection engine |
| `src/pages/ProjectedIncome.tsx` | Add per-date edit/skip UI in monthly sections |

