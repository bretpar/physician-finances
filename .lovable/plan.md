

# Fix: Imported Transaction Edits Not Persisting (Fields Blank on Re-edit)

## Root Cause

When editing an imported Plaid income transaction, the `openEdit` function looks up the transaction's linked `income_entry` via `incomeByLinkedTx.get(tx.id)`. For imported transactions that were **never manually created through the Add Income flow**, no `income_entry` exists — so `linked` is `null`.

This means:
- `gross_amount` falls back to `tx.amount` (works)
- `taxes_withheld`, `pre_tax_deductions`, `retirement_401k`, `net_received` all fall back to `""` (blank)

When the user saves, the `saveIncome` function updates only the `transactions` table (amount, vendor, etc.). Since `editingIncomeEntryId` is null, **no income_entry is created**. The detailed fields (gross, taxes withheld, deductions, retirement) are lost.

On re-edit, the same lookup happens — still no income_entry — fields are blank again.

## Fix

**In `saveIncome()` inside `BusinessActivity.tsx`**: When editing an income transaction that has **no linked income_entry** (`editingIncomeEntryId` is null), **create** a new `income_entry` linked to the transaction instead of silently skipping. This ensures all detailed fields persist.

### Changes

**`src/pages/BusinessActivity.tsx` — `saveIncome()` function (~lines 309-344)**

In the `onSuccess` callback of the `updateMutation.mutate` call for editing income:

- Current code: only calls `updateIncomeMutation.mutate(...)` if `editingIncomeEntryId` exists; otherwise does nothing with the detailed fields
- New code: if `editingIncomeEntryId` is null, call `addIncomeMutation.mutate(...)` to create a new income_entry with `linked_transaction_id` set to the transaction ID, using all the form fields (gross, taxes withheld, deductions, retirement, etc.)

This requires a slight modification to `useAddIncome` (or a new hook) since the current `useAddIncome` also creates a new transaction row. We need to either:
1. **Add a `skipTransaction` flag** to `useAddIncome` so it can create just the income_entry when a transaction already exists, OR
2. **Use a direct Supabase insert** in the `saveIncome` function for this case

Option 2 is simpler — insert directly into `income_entries` in the `onSuccess` callback when no entry exists, then invalidate queries.

### Summary of code changes

1. **`src/pages/BusinessActivity.tsx`** — In `saveIncome()`, inside the `isEditingIncome` branch's `onSuccess`:
   - If `editingIncomeEntryId` exists → update income_entry (current behavior, keep as-is)
   - If `editingIncomeEntryId` is null → insert a new income_entry row with `linked_transaction_id = editingIncomeTxId`, populating all fields from the form. Then set `editingIncomeEntryId` equivalent so future edits update instead of re-creating.

2. **`src/pages/BusinessActivity.tsx`** — In `openEdit()` for income transactions without a linked income_entry: also read from `tx` fields for `actual_withholding` and `notes` (already done, no change needed).

No database migration needed — all tables and columns already exist.

