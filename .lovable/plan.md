

## W-2 Income and Tax Withholding Tracking

### What this adds
A way to record your W-2 job income alongside the taxes already withheld from those paychecks. The system will then subtract your W-2 withholdings from your total estimated tax liability, so your quarterly estimate reflects only what you still owe from 1099/K-1 income.

### Changes

**1. Extend the data model** (`src/lib/mockData.ts`)
- Add `"W-2 Income"` to the categories list
- Add an optional `taxWithheld` field to the `Transaction` type (number, defaults to 0) — used only for W-2 income transactions to record federal/state taxes already paid
- Add sample W-2 mock transactions with `taxWithheld` values (e.g., employer paycheck of $12,000 with $3,200 withheld)

**2. Update tax calculations** (`src/lib/mockData.ts` — `getSummary`)
- Sum `taxWithheld` from all W-2 transactions in the period
- Return `w2Income`, `w2Withheld` in the summary
- Compute `remainingTaxLiability = totalTax - w2Withheld`
- Adjust `quarterlyEstimate` to be based on remaining liability only (non-W-2 income tax minus W-2 withholdings already paid)
- SE tax and B&O tax should only apply to non-W-2 income (W-2 employers handle FICA)

**3. Add W-2 income entry in the Transactions page** (`src/pages/Transactions.tsx`)
- Add an "Add W-2 Income" button at the top
- Opens a dialog with fields: date, employer name, gross pay, federal tax withheld, state tax withheld, memo
- Creates a transaction with category "W-2 Income" and stores withholding in `taxWithheld`
- The existing edit dialog will also show `taxWithheld` field when category is "W-2 Income"

**4. Update Dashboard** (`src/pages/Dashboard.tsx`)
- Add a stat card showing "W-2 Tax Withheld" so you can see credits against your liability
- Adjust the "Tax Set-Aside" card to show the net amount still needed (total liability minus W-2 withholdings)

**5. Update Tax Planning page** (`src/pages/TaxPlanning.tsx`)
- Add a "W-2 Withholdings" row in the tax breakdown showing taxes already paid
- Show adjusted quarterly estimate: `(total tax - W-2 withheld) / remaining quarters`
- Add a summary line: "Already covered by W-2 withholdings" vs "Still owed from 1099/K-1"

### Key tax logic
- W-2 income is included in total income and federal tax calculation
- SE tax (15.3%) applies only to 1099/K-1/side business income (not W-2)
- B&O tax applies only to non-W-2 business income
- Quarterly estimates = (federal tax on all income + SE tax on self-employment income + B&O) minus W-2 withholdings, divided by 4

