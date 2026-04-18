
The user wants the "amount to set aside for taxes" input restored on the Business Activity income form. The recommendation shows but there's no input to capture what they're actually saving.

Looking at the codebase: `BusinessActivity.tsx` uses `showField()` gated by `visibleFields` from the company's advanced toggles. The relevant toggle key is likely `additional_tax_reserve` (or `actual_withholding` per the plan history). Per `mem://features/income-architecture` context: `additional_tax_reserve` = recommended set-aside the user commits to saving; `actual_withholding` = legacy, now repurposed.

Need to verify exact toggle key + ensure it's in defaults for 1099/Schedule C, S-Corp Distribution, Other — and that the input renders even when the recommendation card is shown.

## Plan

**Restore "Amount saving for taxes" input in Business Activity income form.**

1. **`src/lib/filingTypes.ts`** — Confirm/add `additional_tax_reserve` toggle option (label: "Amount saving for taxes") to:
   - 1099 / Schedule C (default ON)
   - S-Corp Distribution (default ON)
   - Other (default ON, optional)
   - K-1 Partnership (available, default OFF)

2. **`src/pages/BusinessActivity.tsx`** — In the Advanced section, render an input for `additional_tax_reserve` directly under the "Recommended set-aside" display card whenever `showField("additional_tax_reserve")` is true. Label: "Amount you're saving for taxes". Helper: "Tracked as a reserve — does not count as taxes already paid." Wire to `incomeForm.additional_tax_reserve` state and persist via existing save path (`income_entries.additional_tax_reserve` column already exists).

3. **Save behavior** — Use the existing `preserve()` helper so hidden values aren't zeroed. Confirm the value is NOT added to `taxesWithheld` in the tax engine — it stays a separate reserve number (already handled per prior plan).

4. **Edit mode** — Field auto-shows for legacy transactions with a saved `additional_tax_reserve > 0` via `showField` legacy logic.

## Files
- `src/lib/filingTypes.ts` — toggle option + defaults
- `src/pages/BusinessActivity.tsx` — render input in Advanced section

No DB migration needed (`additional_tax_reserve` column exists).
