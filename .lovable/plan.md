

## Fix: Account for actual_withholding in tax calculations

**Root Cause**

Two separate "taxes withheld" values exist and they are disconnected:

1. `income_entries.taxes_withheld` — filled during income creation (your entry has this as $0)
2. `transactions.actual_withholding` — the $25,000 you entered in the edit form

The tax engine (`useTaxEstimate`) only reads from source #1 via `useWeightedIncome`. Source #2 is stored but ignored in all tax calculations. That is why $25,000 does not appear on the Dashboard or Tax page.

**Fix**

### 1. Include `actual_withholding` from transactions in the tax estimate

In `src/hooks/useTaxEstimate.ts`, after computing `combinedWithheld` from income entries and projected streams, also sum `actual_withholding` from income transactions. This ensures user-entered withholding is counted.

Specifically: query `transactions` for income-type rows, sum their `actual_withholding`, and add it to `combinedWithheld` (while avoiding double-counting with `income_entries.taxes_withheld`).

### 2. Sync actual_withholding back to income_entries.taxes_withheld

In `src/pages/Transactions.tsx`, when saving an income transaction edit, also update the linked `income_entries.taxes_withheld` to match `actual_withholding`. This keeps both records consistent and means the weighted income hook automatically picks up the correct value.

### 3. Update Dashboard "Saved So Far" logic

The Dashboard currently compares `tax_savings` table totals against remaining tax. The `actual_withholding` from transactions should also count toward "covered" — either by including it in the `taxesAlreadyWithheld` path (approach #2 handles this) or by adding it to the "Saved So Far" display.

**Recommended approach**: Option #2 is the cleanest — sync `actual_withholding` to `income_entries.taxes_withheld` on save, so the existing weighted income pipeline automatically accounts for it. Then add a safety net in `useTaxEstimate` that also reads `actual_withholding` from transactions for any unlinked entries.

### Files to change
- `src/pages/Transactions.tsx` — sync `actual_withholding` to the linked income entry's `taxes_withheld` on save
- `src/hooks/useTaxEstimate.ts` — add fallback: sum `actual_withholding` from income transactions and use whichever is greater (income_entries.taxes_withheld or transactions.actual_withholding) to avoid double-counting
- `src/pages/Dashboard.tsx` — no structural change needed; once the estimate includes the withheld amount, `remaining` will decrease automatically

