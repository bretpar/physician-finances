# Personal Income parity with Business Activity

Bring the Personal Income ledger to feature parity with Business Activity, and clean up the inline list view.

## What changes

### 1. Income detail card (when a row is tapped)

Match the Business Activity detail sheet exactly:

- **Receipts section** at the top of `extraContent` — upload/view receipts on the canonical income entry, plus a read-only list of receipts from any linked sibling entries (same `SiblingReceiptsList` pattern).
- **Linked transactions section** — show siblings, allow Unlink, and an "+ Link transaction" action that drops the user into multi-select mode.
- **Mark as reviewed button** — visible only when `needs_review === true`; clicking flips it to false and refreshes the row.
- Keep the existing Edit / Delete buttons and all the existing tax-detail badges/fields inside the expanded card.

### 2. Income ledger (list view)

Remove the inline badges from each `LedgerRow`:

- `Withheld $X`
- `Reserve $X`
- `From Planner`
- `YTD`
- `📎 N` (attachment count chip)

These all disappear from the ledger row. They remain visible inside the detail card (badges in the sheet header + fields in the Tax Details section) so nothing is lost — the list just gets quieter and matches Business Activity's cleaner look. Keep the Review badge for user to know which ones need reviewing

The "View Receipts" button under a row also goes away; receipts move into the detail card.

### 3. Long-press to multi-select + Link

Same UX as Business Activity:

- Long-press an income row → enters mobile selection mode.
- Tap additional rows to add them to the selection.
- A floating "Link N transactions" action bar appears; tapping creates a linked match group.
- The match-group system already supports cross-source linking via `transaction_match_group_items.transaction_source`; we extend it with `transaction_source = 'income_entry'` so the same group/unlink/double-count protection logic applies. No double-counting in tax totals — when entries are linked, only the canonical entry contributes.

### 4. Filter chip cleanup

The "Needs Review" filter chip at the top of the ledger stays — it's how users find rows that still need review

## Technical details

Files touched:

- `src/pages/PersonalIncome.tsx` — strip badges from the mobile `LedgerRow`, wire `extraContent` (Receipts + sibling receipts), `linked` prop, `onMarkReviewed`, `needsReview`, and long-press selection state into the existing `TransactionDetailSheet`. Reuse the `enterMobileSelectionWith` / selection-bar pattern from Business Activity.
- `src/hooks/useTransactionMatching.ts` — accept `transaction_source = 'income_entry'` when creating/loading match group items so income entries can participate in linked groups alongside transactions. Keep the "already in an active matched group" guard.
- `src/hooks/usePersonalIncome.ts` — when computing totals (`totalIncome`, `w2Income`, `totalWithheld`), de-dupe by linked group so linked siblings count once. Mirrors the dedupe logic already in Business Activity.
- New migration: allow `'income_entry'` as a valid `transaction_source` value on `transaction_match_group_items` (text column today, but add a CHECK constraint or update the existing one if present).

## Out of scope

- No changes to the Add/Edit income dialog.
- No changes to tax engine math beyond the dedupe-by-link rule already used for business transactions.
- No new desktop-only UI; long-press behavior matches mobile-first Business Activity.