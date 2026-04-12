

## Fix: W2 Withholding Recommendation Should Exclude SE Tax

**Problem**

The withholding recommendation uses the annual `effectiveRate` which is calculated as `(federalTax + seTax + bnoTax) / totalIncome`. When applied to a W2 entry, the recommendation inflates the number because SE tax and B&O tax are baked into the rate — but those taxes don't apply to W2 income.

**Root Cause**

The `effectiveRate` from the tax engine is a blended rate across all income types. The per-entry recommendation hook applies this same rate to W2 and 1099 entries alike.

**Fix**

### 1. Expose a federal-only effective rate from the tax engine

In `src/lib/taxEngine.ts`, add a new field to `TaxEstimate`:

```
federalEffectiveRate = (federalTax / totalIncome) * 100
```

Return it alongside the existing `effectiveRate`.

### 2. Use the correct rate per income type in the recommendation hook

In `src/hooks/useWithholdingRecommendation.ts`:

- **W2 entries**: Use `federalEffectiveRate` (no SE tax, no B&O)
- **1099/K1 entries**: Use `effectiveRate` (which already includes SE + B&O), no need to add SE tax again on top

This also means removing the current explicit SE tax addition on lines 117-118, since for 1099/K1 the blended `effectiveRate` already accounts for it.

### Files to change

| File | Change |
|------|--------|
| `src/lib/taxEngine.ts` | Add `federalEffectiveRate` to `TaxEstimate` interface and return value |
| `src/hooks/useWithholdingRecommendation.ts` | Use `federalEffectiveRate` for W2, `effectiveRate` for 1099/K1; remove redundant SE tax addition |

