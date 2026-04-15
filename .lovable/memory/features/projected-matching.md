---
name: Projected Income Matching
description: Projected income paychecks match against actual income entries using company+amount+date proximity, not date-only filtering
type: feature
---

## Matching Logic (useProjectedIncome.ts)

Projected paychecks are generated for the full year and matched against actual income entries using:
- Date proximity (±3 days, scored 15-40 points)
- Company name similarity (scored 30 points)
- Gross amount similarity (within 10%, scored 5-30 points)
- Minimum threshold: 45 points (date + one other signal)

## Match Statuses (ProjectedMatchStatus)
- `active` — future paycheck, not yet matched, counts in projected totals
- `matched` — actual income exists, does NOT count in projected totals
- `past_due` — date passed with no matching actual income, does NOT count in totals
- `skipped` — user explicitly skipped via override, does NOT count

## Key Rule: Only "active" paychecks count in projected totals
`getProjectedTotals()` filters to `matchStatus === "active"` only.

## Tax Estimate Integration
- `actualEstimate` uses only real income (transactions + income_entries)
- `forecastEstimate` adds projected income (only active/unmatched paychecks)
- No double-counting: matched projected items are excluded from forecast totals

## MatchableIncomeEntry Interface
Both IncomeEntry and PersonalIncomeEntry work for matching via the minimal interface:
`{ id, income_date, company, paycheck_amount, income_type, status }`
