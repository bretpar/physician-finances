# Fix: Income Planner / Plaid matching never overwrites the planned ledger

## Problem

Two related defects in the matching flow:

1. **Projected paychecks** are tagged `matchStatus: "matched"` purely by a heuristic in `useProjectedIncome.ts` (date + company + amount score). No row is written to any link table, no user confirmation happens. The UI says "Matched" but nothing is actually linked.
2. The link/merge flow in `useTransactionMatching.ts` flips the manual ledger row to `source_type: "merged"` and soft-marks the Plaid row as `merged`. That part keeps the planned gross intact, but downstream the business ledger does not surface the linked Plaid net deposit, and there is no warning when the deposit differs from the planned net. There is also no "View linked deposit" affordance from the ledger row.

## Goal

The planned/business ledger entry stays the source of truth. Plaid only contributes net deposit metadata (amount, posted date, account, merchant, plaid id). Auto-detected matches are surfaced as **suggestions** that require confirmation, and once confirmed the relationship is queryable from the ledger row.

## Changes

### 1. Stop auto-marking projected paychecks as "Matched"

`src/hooks/useProjectedIncome.ts`

- Add new status `"suggested"` to `ProjectedMatchStatus`.
- In the matching loop (~line 715), when `findMatchingIncome` returns a candidate, only set `matchStatus: "matched"` if the actual income entry is actually linked back to this projected paycheck via `origin_planner_conversion_id` or `entry_kind === "planner_conversion"` (i.e. it came from a confirmed planner conversion). Otherwise tag it `"suggested"` and surface `suggestedIncomeId` / `suggestedAmount` instead of `matchedIncomeId`.
- Treat `"suggested"` like `"active"` for totals (it still counts as projected income until the user confirms — prevents double-counting the actual entry only after the confirmed link exists).

`src/pages/ProjectedIncome.tsx` and any consumer that renders the badge:

- Render `"suggested"` as **"Suggested match"** (amber) and `"matched"` as **"Matched deposit"** (green). Surface a "Confirm match" CTA on suggested rows that calls the existing `useLinkTransactions` flow (or a new `useConfirmProjectedMatch` mutation) to write the real link.

### 2. Guarantee the manual/planned row keeps its fields on link

`src/hooks/useTransactionMatching.ts` → `useLinkTransactions`

- Add an explicit safety: before update, re-read the manual row and keep `amount`, `vendor`, `entity`, `category`, plus all planner-derived fields untouched. Only mutate `match_status`, `linked_group_id`, `source_type`, `status`, `linked_plaid_transaction_id` (new column, see below).
- Persist `linked_plaid_transaction_id` and `linked_plaid_amount` on the manual transaction so the ledger can show the net deposit beside the planned gross without joining `transaction_links` on every render.
- If `Math.abs(plaidAmount - expectedNet) / expectedNet > 0.05`, return a `requiresConfirmation: true` flag and surface the warning copy in the UI: *"Deposit differs from planned net amount. Keep planned gross details and update net received?"*

### 3. Schema additions (migration)

```sql
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS linked_plaid_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS linked_plaid_amount numeric,
  ADD COLUMN IF NOT EXISTS linked_plaid_posted_date date,
  ADD COLUMN IF NOT EXISTS linked_plaid_account text;
```

These are denormalized convenience columns. The authoritative link still lives in `transaction_links`.

### 4. Ledger row UI

`src/components/LedgerRow.tsx` (and the matching projected-income row component)

- When `linked_plaid_transaction_id` is set, render a small subline: *"Net deposit: $X,XXX.XX · Posted MM/DD · ••••1234"* with two actions:
  - **View linked deposit** → opens a dialog with the Plaid raw row.
  - **Unlink** → calls existing `useUnlinkTransactions(linked_group_id)`.
- When `matchStatus === "suggested"`, render an amber "Suggested match" pill plus **Confirm** / **Dismiss** buttons. Dismiss writes to `transaction_match_ignores`.

### 5. Tax engine

No change required — it already reads from the manual/income_entries rows, not from Plaid rows. Add a regression test in `src/test/` that asserts a linked Plaid row with a different net amount does not change the taxable income returned by `calculateFullEstimate`.

## Files touched

- `supabase/migrations/<new>.sql` — add denorm columns
- `src/hooks/useProjectedIncome.ts` — `"suggested"` status, gate "matched" on real link
- `src/hooks/useTransactionMatching.ts` — preserve manual fields, write denorm columns, return discrepancy flag
- `src/pages/ProjectedIncome.tsx` — render suggested vs matched, confirm CTA
- `src/components/LedgerRow.tsx` — linked deposit subline + view/unlink actions
- `src/components/SuggestedMatches.tsx` — copy update ("Suggested match" / "Matched deposit"), discrepancy warning
- `src/test/projectedMatchSuggested.test.ts` — new test for the gating rule
- `src/test/taxEngine.test.ts` — add assertion that linked Plaid amount does not affect tax

## Out of scope

- Reworking the many-to-many `transaction_match_groups` flow (already user-confirmed).
- Changing how `planner_conversions` writes income entries (that path already keeps the planned gross).
