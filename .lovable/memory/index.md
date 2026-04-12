# Project Memory

## Core
Physician finance app — income/expense tracking, tax planning, WA B&O tax.
Fintech design: light theme, Inter font, blue primary (#0066CC), teal accent.
MVP mode: 4 pages only (Dashboard, Transactions, Deductions, Taxes). Keep simple.
Advanced features (Stocks, Projected Income, Reports, Income Analytics) hidden, not deleted.
Route /deductions maps to Mileage.tsx (mileage + retirement).
Tax engine uses projected annual income + marginal brackets for withholding recommendations.

## Memories
- [Tax rates](mem://features/tax-rates) — Federal 32%, SE 15.3% (×0.9235), WA B&O 1.5% of gross income
- [Withholding engine](mem://features/withholding-engine) — Smart recommendation using projected annual model, proportional allocation per transaction
