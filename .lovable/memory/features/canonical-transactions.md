---
name: Canonical Transaction Source
description: transactions table is the single source of truth for both Business Ledger and Tax Overview business income; income_entries only enriches
type: feature
---

## Single source of truth

`transactions` (with `status='active'`) is the canonical source of business
income for BOTH the Business Ledger and the Tax Overview. They MUST agree.

- **Business Ledger** (`useBusinessLedger`): reads `transactions` filtered by
  `user_id`, `source_id`, `status='active'`, `excluded_from_reports=false`.
- **Tax Overview** (`useTaxEstimate` → `canonicalBusiness`): reads
  `transactions` where `transaction_type='income'` and `status='active'`,
  classifies each by company filing type into SE / W-2 / other gross.

`income_entries` is now ONLY an **enrichment layer**. For each income_entry
that has a `linked_transaction_id` pointing to a live active transaction, we
pull `federal_withholding`, `state_withholding`, `pre_tax_deductions`,
`retirement_401k`, and `owner_healthcare`. Orphaned income_entries (linked
tx no longer exists) contribute NOTHING to tax math.

## Why

Before: Tax Overview summed `income_entries.paycheck_amount`. When a user
manually deleted a transaction in the DB, the linked income_entry became an
orphan, the orphan filter dropped it, and Gross Business Income fell to $0
while expenses (read from transactions) stayed correct. The two screens
disagreed.

After: Both screens read the same `transactions` rows. Deleting a
transaction removes it from both immediately and consistently.

## Cleanup paths

- Tax Overview filters orphans at read time (no recomputation needed).
- Settings → Data Maintenance → "Orphaned income entries" deletes orphan
  rows from the DB in one click.
- `/debug/transactions` shows per-row inclusion in Ledger vs Tax Overview.
