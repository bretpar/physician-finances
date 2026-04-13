---
name: Withholding Recommendation Engine
description: Global withholding method in Settings controls recommendations across all income sections using combined total income
type: feature
---

## Global Withholding Method (tax_settings.withholding_method)
Three options set in Settings → Tax Withholding Method:
- `flat_estimate` — user-defined flat %. Uses `manual_effective_tax_rate` field. Adds SE tax for non-W2.
- `dynamic_actual` (default) — bracket-based using actualEstimate (all real income)
- `dynamic_planner` — bracket-based using forecastEstimate (actual + projected). Premium-ready.

## Engine Location
- `src/hooks/useWithholdingRecommendation.ts` — main hook, reads global method from settings
- `src/lib/taxEngine.ts` — bracket definitions, progressive tax calculation
- `src/hooks/useTaxEstimate.ts` — produces actualEstimate and forecastEstimate

## Combined Income Sources
Recommendations always use the FULL income picture:
- Business Activity transactions
- Personal & External Income entries
- Stock/capital gains
- Deductions, retirement contributions
- Taxes already withheld/set aside

## Per-Entry Calculation
1. Net taxable = gross - retirement401k - preTaxDeductions
2. Select rate by income type:
   - W2: `federalEffectiveRate` (no SE/B&O)
   - 1099/K1: `effectiveRate` (blended: federal + SE + B&O)
3. Tax on entry = netTaxable × rate
4. Subtract taxesAlreadyWithheld → recommended withholding
5. W2 allows negative (over-withheld); 1099/K1 floors at 0

## UI
- Settings page has Tax Withholding Method section with radio buttons
- Income forms show: "Withholding method controlled in Settings"
- No per-form method selection
