---
name: Withholding Recommendation Engine
description: Smart tax withholding using projected annual income + marginal brackets, with per-income-type rate selection
type: feature
---

## Engine Location
- `src/hooks/useWithholdingRecommendation.ts` — main hook
- `src/lib/taxEngine.ts` — bracket definitions, progressive tax calculation, federalEffectiveRate
- `src/hooks/useTaxEstimate.ts` — full annual estimate combining actual + projected income

## Calculation Flow
1. Accept per-entry details: grossIncome, incomeType, taxesAlreadyWithheld, retirement401k, preTaxDeductions
2. Compute net taxable = gross - retirement401k - preTaxDeductions
3. Select rate by income type:
   - W2: `federalEffectiveRate` (federal income tax only, no SE/B&O)
   - 1099/K1: `effectiveRate` (blended: federal + SE + B&O)
4. Tax on entry = netTaxable × rate
5. Subtract taxesAlreadyWithheld → recommended withholding
6. W2 allows negative (over-withheld); 1099/K1 floors at 0

## Tax Modes (tax_settings table)
- `projected_brackets` (default) — full bracket model with type-specific rates
- `manual_effective_rate` — flat rate override; adds SE tax for non-W2

## Key Fields in TaxEstimate
- `effectiveRate` = (federalTax + seTax + bnoTax) / totalIncome × 100
- `federalEffectiveRate` = federalTax / totalIncome × 100
