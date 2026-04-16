---
name: K-1 Owner Deductions
description: K-1 income tracks owner healthcare, retirement, pre-tax deductions separately from business expenses
type: feature
---

## Concept
K-1/partnership income has two types of deductions:
1. **Business expenses** — reduce business profit (tracked in transactions table)
2. **Owner deductions** — reduce taxable income but NOT profit (tracked on income_entries)

## Database
- `income_entries.owner_healthcare` (numeric, default 0) — healthcare premiums through partnership
- `income_entries.retirement_401k` — already existed, used for owner retirement
- `income_entries.pre_tax_deductions` — already existed, used for other owner deductions

## Tax Engine Flow
1. Business profit = business income − ordinary business expenses
2. Taxable income = profit − owner deductions (healthcare + retirement + pre-tax) − standard deduction
3. Owner deductions flow through `ownerHealthcare` in `UnifiedTaxInput` → added to `combinedPreTax`
4. Taxes withheld/set aside are payments, not deductions

## UI
- Income form shows "Owner Deductions / K-1 Adjustments" section when income_type = K1
- Summary cards show separate owner deductions row below profit
- Explanatory text: business expenses reduce profit, owner deductions reduce taxable income
