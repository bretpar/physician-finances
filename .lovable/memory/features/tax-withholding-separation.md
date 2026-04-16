---
name: Actual vs Recommended Tax Separation
description: taxes_withheld stores only actual withholding; recommended set-aside is advisory in additional_tax_reserve
type: feature
---

## Core Rule
- `taxes_withheld` on income_entries = ONLY actual taxes withheld or paid → reduces tax owed
- `additional_tax_reserve` = recommended set-aside → advisory, does NOT reduce tax owed
- `dynamic_tax_recommendation` = computed recommendation amount → advisory only

## Tax Engine Formula
estimated_total_tax_liability
- actual_tax_withheld (from taxes_withheld field)
- actual_estimated_tax_payments (from tax_payments table)
= remaining_tax_needed

## Income Type Behavior
- W2: Show "Taxes Already Withheld" — saved to taxes_withheld, reduces tax owed
- 1099/K1/Business: Show "Actual Taxes Withheld/Paid" defaulting to $0 + "Recommended Tax Set-Aside" as advisory
- recommended_tax_set_aside NEVER subtracted from tax owed

## Business Activity Income Types
W2/Paycheck, 1099/Contractor, K-1/Partnership, Business Income, Other Income
