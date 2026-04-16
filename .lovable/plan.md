

# Fix: Separate "Taxes Withheld" from "Tax Reserve for Quarterly Payments"

## Problem

Two conceptually different tax amounts are being conflated:

1. **Taxes Withheld** (Advanced section) — taxes already deducted from paycheck by the employer. These are **already paid** to the IRS.
2. **Actual amount withheld / set aside** — the amount the user plans to **set aside** for quarterly estimated tax payments. This is **not yet paid**.

Currently, the system treats both as "taxes already covered" via `Math.max(businessWithheld, txActualWithholding)` in `useTaxEstimate.ts` (line 149). This means:
- The tax reserve amount incorrectly reduces the estimated remaining tax liability
- For 1099 income (no employer withholding), the set-aside amount is being counted as if taxes were already paid when they haven't been

## Changes

### 1. UI Label Clarification (`BusinessActivity.tsx`)
- Rename "Actual amount withheld / set aside" → **"Amount to set aside for quarterly taxes"**
- Add helper text: "This is your recommended reserve — it will be tracked separately until you make a quarterly payment"
- The "Recommended to set aside" box above already shows the right number; the input below it is where the user confirms how much they're actually reserving

### 2. Stop Counting `actual_withholding` as Taxes Paid (`useTaxEstimate.ts`)
- **Line 149**: Change `combinedWithheld = Math.max(baseData.businessWithheld, baseData.txActualWithholding) + ...` to just use `baseData.businessWithheld + baseData.personalWithheld`
- Remove `txActualWithholding` from the `taxesWithheld` input to `calculateFullEstimate`
- Instead, track `actual_withholding` totals as a separate "tax reserves" number (alongside `taxSavings`) — it flows into `additionalTaxPaid` or a new `taxReserves` bucket

### 3. Route `actual_withholding` into Tax Savings/Reserves (`useTaxEstimate.ts`)
- Add `txActualWithholding` to `additionalTaxPaid` (line 126): `const additionalTaxPaid = quarterlyPaid + savingsTotal + txActualWithholding`
- This way, the set-aside amount is tracked as "money earmarked but not yet submitted to IRS" — same bucket as tax savings
- **Or**, if the user wants it completely separate until a quarterly payment is made, remove it from all "already covered" calculations and only show it as an informational reserve

### 4. Fix `effectiveWithheld` Merge in `saveIncome` (`BusinessActivity.tsx`)
- **Line 316**: Stop merging the two: `const effectiveWithheld = Math.max(taxWithheld, num(incomeForm.actual_withholding))`
- Change to: save `taxes_withheld` and `actual_withholding` as separate fields
- `income_entries.taxes_withheld` = only the employer/paycheck withholding amount
- `transactions.actual_withholding` = only the quarterly tax reserve amount

### 5. Same fix in forecast estimate (`useTaxEstimate.ts` line 183)
- Remove `txActualWithholding` from `combinedWithheld` in the forecast estimate path as well

## Summary of Semantic Separation

| Field | Meaning | Counts as "taxes paid"? |
|-------|---------|------------------------|
| `taxes_withheld` (income_entries) | Employer already sent to IRS | Yes |
| `actual_withholding` (transactions) | User setting aside for quarterly payment | No — tracked as reserve |
| Quarterly tax payments | User actually paid to IRS | Yes |
| Tax savings | Money in savings for taxes | Yes (earmarked) |

## Files Modified
- `src/pages/BusinessActivity.tsx` — label rename, fix `effectiveWithheld` merge
- `src/hooks/useTaxEstimate.ts` — separate `txActualWithholding` from `combinedWithheld`, route to reserves

