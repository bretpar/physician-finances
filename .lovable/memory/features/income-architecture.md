---
name: Income Architecture
description: Three-section income model separating business, personal, and projected income
type: feature
---

## Three Sections
1. **Business Activity** (`/business-activity`) — Operational cash flow: 1099/K1 income + business expenses only. No W2/personal items.
2. **Personal & External Income** (`/personal-income`) — Actual non-business income: W2, capital gains, dividends, interest, rental, losses.
3. **Income Planner** (`/projected-income`) — Forward-looking projected/hypothetical income streams.

## Database
- `income_entries` table has `source_bucket` ('personal' | 'projected'), `tax_category`, `gross_amount`, `cost_basis`, `realized_gain_loss`, `federal_withholding`, `state_withholding`, `is_actual`, `include_in_tax_estimate`, `include_in_cash_flow`
- Business transactions still use `transactions` table
- Projected recurring streams still use `projected_income_streams` + `projected_bonus_events` + `projected_income_overrides`

## Hooks
- `usePersonalIncome.ts` — CRUD for personal income entries (source_bucket='personal', is_actual=true)
- `useIncome.ts` — Legacy hook still used for business-linked income entries
- `useTaxEstimate.ts` — Aggregates business + personal + projected income

## Tax Aggregation
- Business: transactions table (income + expenses)
- Personal: income_entries where source_bucket='personal'
- Projected: projected_income_streams + projected_bonus_events
- All feed into `calculateFullEstimate()` in taxEngine.ts

## No Duplicate Counting
- Business items only in Business Activity
- Personal items only in Personal Income
- Projected items only in Income Planner
