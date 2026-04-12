

## Fix: Withholding Recommendation Should Account for Per-Entry Deductions and Income Type

**Problem**

`getRecommendation(grossIncome)` passes the full gross amount. The engine then proportionally allocates the remaining annual tax to that gross amount — but ignores the fact that this specific entry may have 401k, pre-tax deductions, and (for W2) taxes already withheld by the employer. Result: the recommendation equals roughly the gross amount itself.

**Root cause in `useWithholdingRecommendation.ts`**

The function only takes `incomeAmount` (gross). It needs additional context about the entry: income type, taxes already withheld, 401k, and pre-tax deductions.

**Fix**

### 1. Update `useWithholdingRecommendation.ts`

Change `getRecommendation` signature to accept an object:

```typescript
getRecommendation({
  grossIncome: number,
  incomeType: 'W2' | '1099' | 'K1',
  taxesAlreadyWithheld: number,  // W2 employer withholding
  retirement401k: number,
  preTaxDeductions: number,
  alreadyIncludedInEstimate: boolean
})
```

Calculation logic:
- Compute **net taxable income** for this entry: `gross - retirement401k - preTaxDeductions`
- For SE income (1099/K1): also factor in SE tax portion
- Use the effective rate from the annual estimate to compute the tax owed on **this entry's net taxable portion**
- Subtract `taxesAlreadyWithheld` (the W2 employer withholding for this specific paycheck)
- Result = additional amount to withhold/set aside
- **Allow negative values for W2**: if the employer already withheld enough (or too much), show a negative number with a message like "Your employer withheld more than needed for this paycheck"

### 2. Update `src/pages/Transactions.tsx`

Pass the additional form fields to `getRecommendation`:

```typescript
const recommendation = useMemo(() => {
  if (!isIncome || grossIncome <= 0) return null;
  return getRecommendation({
    grossIncome,
    incomeType: form.income_type,
    taxesAlreadyWithheld: num(form.taxes_withheld),
    retirement401k: num(form.retirement_401k),
    preTaxDeductions: num(form.pre_tax_deductions),
    alreadyIncludedInEstimate: isEditing,
  });
}, [isIncome, grossIncome, form.income_type, form.taxes_withheld, form.retirement_401k, form.pre_tax_deductions, getRecommendation, isEditing]);
```

Update the UI display:
- If recommendation is negative (W2 over-withheld): show green text "Your employer withheld $X more than estimated — consider adjusting your W-4"
- If recommendation is positive for W2: show "Additional withholding recommended: $X" with a note that their W2 employer isn't withholding enough
- If recommendation is positive for 1099/K1: show "Recommended to set aside: $X"

### 3. Calculation detail (inside the hook)

```
netTaxableForEntry = grossIncome - retirement401k - preTaxDeductions
taxOnThisEntry = netTaxableForEntry × (estimate.effectiveRate / 100)

// For 1099/K1, add SE tax portion
if (incomeType !== 'W2') {
  seTaxPortion = netTaxableForEntry × SE_INCOME_FACTOR × SE_TAX_RATE
  taxOnThisEntry += seTaxPortion
}

recommendedWithholding = taxOnThisEntry - taxesAlreadyWithheld
// Allow negative for W2 (means employer over-withheld)
// For 1099/K1, floor at 0
```

### Files to change

| File | Change |
|------|--------|
| `src/hooks/useWithholdingRecommendation.ts` | Accept entry-level details; compute recommendation on net taxable amount minus already-withheld |
| `src/pages/Transactions.tsx` | Pass form fields to `getRecommendation`; handle negative recommendation display for W2 |

