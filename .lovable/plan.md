# Surface business YTD catch-up in Business Activity ledger

## Problem

Business YTD catch-up entries (`ytd_catchup_entries` with `source_type = '1099_k1'`)
are counted by the tax engine but never appear in the Business Activity ledger,
which reads only from `transactions`. Adding a duplicate transaction would
double-count taxes because the engine's overlap safeguard subtracts overlapping
`income_entries`, not overlapping `transactions`.

## Approach

Insert one real income `transaction` per business YTD catch-up entry, tagged so
both the ledger and the tax engine know its origin. Extend the engine's overlap
safeguard so overlapping catch-up-origin `transactions` are also subtracted.
The catch-up entry remains the source of truth — the transaction is its
projection into the ledger and gets kept in sync.

## Changes

### 1. Schema (migration)

- `transactions`: add column `origin_ytd_catchup_id uuid` (nullable, indexed).
- Extend `origin_type` usage to include the value `'ytd_catchup'` (no enum
  change needed — column is `text`).
- No RLS changes (existing policies on `transactions` already cover it).

### 2. Sync layer (`useYtdCatchup.ts`)

When a business catch-up (`source_type = '1099_k1'`) is created/updated:

- Upsert one paired row in `transactions` with:
  - `transaction_type = 'income'`
  - `transaction_date = period_end`
  - `vendor = 'YTD catch-up: ' + company_name`
  - `amount = gross_income`
  - `actual_withholding = federal_withholding + state_withholding`
  - `source_id = company_id`, `entity = company_name`, `company_type = '1099_schedule_c'`
  - `origin_type = 'ytd_catchup'`, `origin_ytd_catchup_id = catchup.id`
  - `status = 'active'`, `excluded_from_reports = false`, `user_edited = false`

When deleted, also delete the paired transaction.

W‑2 and "other" catch-ups do NOT get a paired transaction (they are personal,
not business ledger).

### 3. Tax engine overlap safeguard (`useTaxEstimate.ts`)

Currently subtracts overlapping `income_entries` (excluding `entry_kind = 'ytd_catchup'`)
from each catch-up bucket. Extend to also subtract overlapping business
`transactions` for the `business` bucket only:

- For a business catch-up entry, find `transactions` where:
  - `transaction_type = 'income'`
  - `status = 'active'`, not excluded
  - `origin_type != 'ytd_catchup'` (skip the synthetic row we just created)
  - `transaction_date BETWEEN period_start AND period_end`
- Subtract their `amount` from `cBizGross`, and subtract proportional
  `actual_withholding` from `cFedW`.

This guarantees: even though the catch-up now has a paired transaction in the
ledger, the canonical-business sum already includes that transaction, and the
catch-up's own bucket clamps to zero for the overlapping portion. No double
count.

### 4. Ledger UI (`BusinessActivity.tsx`)

- Render catch-up-origin rows with a visible "YTD catch-up" badge.
- Make these rows read-only in the ledger (edit/delete disabled); show
  hint text "Edit on the YTD catch-up form".
- Clicking edit/delete opens the YTD catch-up form pre-filled with the linked
  entry.

### 5. Backfill (one-time, via insert tool after migration)

For every existing `ytd_catchup_entries` row with `source_type = '1099_k1'`
that has no paired transaction, insert the matching transaction.

## Files touched

- New migration (schema + index).
- `src/hooks/useYtdCatchup.ts` — upsert/delete paired transaction.
- `src/hooks/useTaxEstimate.ts` — extend overlap subtraction for business bucket.
- `src/pages/BusinessActivity.tsx` — badge + read-only treatment for
  catch-up-origin rows.
- Backfill insert (separate step).

## Verification

- Existing `useTaxEstimate` overlap tests still pass.
- Add unit test: business catch-up of $50k + paired transaction of $50k →
  Tax Overview business gross = $50k (not $100k), ledger shows the row once.
- Manual: create a business catch-up, confirm row appears in Business Activity
  with badge, confirm Tax Overview Gross Business Income matches Ledger total.
