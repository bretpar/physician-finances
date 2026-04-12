---
name: Withholding Recommendation Engine
description: Smart tax withholding using projected annual income + marginal brackets, proportional allocation per income entry
type: feature
---

## Engine Location
- `src/hooks/useWithholdingRecommendation.ts` — main hook
- `src/lib/taxEngine.ts` — bracket definitions and progressive tax calculation
- `src/hooks/useTaxEstimate.ts` — full annual estimate combining actual + projected income

## Calculation Flow
1. Estimate annual income = actual YTD + projected remaining
2. Subtract deductions (pre-tax, retirement, business, mileage, standard deduction)
3. Calculate federal tax via progressive brackets + SE tax + B&O
4. Subtract taxes already withheld/paid
5. Proportionally allocate remaining tax to current income entry

## Tax Modes (tax_settings table)
- `projected_brackets` (default) — full bracket model
- `manual_effective_rate` — flat rate override using `manual_effective_tax_rate` column

## Key Rule
Recommendation = remaining_tax × (current_income / remaining_income_base)
Never recommend more than the income amount itself. Handle zero division gracefully.
