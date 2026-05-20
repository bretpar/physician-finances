# Linked-transaction dedupe audit & fix

## Current model (confirmed)

- **`transactions` table** is the canonical source of truth for ledger, Business Activity, Tax Overview, Dashboard, Reports. All reads filter by `status = 'active'`.
- **`income_entries`** is an enrichment layer keyed by `linked_transaction_id`. Orphans are filtered out at read time.
- Linking model:
  - **Suggested match / matched group** (`transaction_match_groups` + items) = system suggestion only. Already excluded from "is linked" checks after the last fix.
  - **User link** (`transaction_links` with `status='linked'` and `created_by_user=true`) = the real source of truth for "these N rows represent one event."
- Dedupe mechanism at link time (in `useLinkTransactions`):
  - Imported (Plaid) rows get flipped to `status='merged'` only when a manual row also exists in the group → they disappear from `useTransactions`.
  - Manual rows stay `status='active'`.

## The actual bug

The dedupe **only works for mixed manual + imported links**. Two failure cases double-count today:

1. **Manual + manual link**: both stay `status='active'` → both appear in every total (Business Activity, Dashboard, Tax Overview, Reports, exports).
2. **Imported + imported link** (no manual anchor): branch `newStatus = hasManual && hasImported ? "merged" : "active"` keeps both active → double-count.

So Test A passes (3 unlinked = $150 ✅), Test C passes (manual+plaid = $50 ✅), but **Test B fails** (3 manual linked → $150 instead of $50).

## Fix

Pick a canonical row at link time using the hierarchy the user specified, then flip every other row in the group to `status='merged'`. This keeps the existing "single source of truth = `transactions WHERE status='active'`" model — every existing total automatically dedupes without touching every consumer.

### Canonical selection (in `useLinkTransactions`)

For the N rows being linked, score each row by:
1. **Completeness** of tax/accounting fields: non-empty `category`, `source_id`, non-zero `recommended_withholding`, `actual_withholding`, presence of linked `income_entry` (gross, withholding, retirement, hsa, owner_healthcare, notes).
2. **Origin preference**: `source_type === 'manual'` or planner-derived (`source_type === 'planner'`) beats imported (`plaid` / other imported).
3. **Tiebreak**: earliest `created_at`.

Highest-scoring row → stays `status='active'` and owns the user link. All others → `status='merged'`. On unlink (`useUnlinkMatchGroup` / `useUnlinkMatchGroupItem`), `restoreTransactions` already flips merged rows back to `status='active'` — no change needed there.

### Net-vs-gross preservation (Test D)

The manual income row already carries `paycheck_amount` / withholding via the linked `income_entry`. The Plaid row is flipped to `merged` and hidden, so net deposit is no longer summed. The UI detail card still reads all linked rows from `transaction_links` (independent of status), so users can still see the $12,500 actual deposit when expanding a link.

## Files to change

- `src/hooks/useTransactionMatching.ts` — add `pickCanonical()` helper; rewrite the status-flipping block in `useLinkTransactions` to use it for all link shapes (manual+manual, manual+plaid, plaid+plaid, N≥3).
- `src/test/transactionLinkingDedupe.test.ts` — new file with Tests A–E expressed against a small in-memory model of the canonical selector + the `status='active'` filter that every total uses.

## Out of scope (verified safe, no change needed)

- Per-consumer dedupe in `useExpenseSummary`, `useTaxEstimate`, `useTaxBreakdown`, `useDashboardSummary`, `useBusinessLedger`, exports, monthly/quarterly charts. All of them read from `transactions` filtered to `status='active'`, so once the link step picks one canonical row, every downstream total dedupes for free.
- `income_entries.linked_transaction_id` orphan handling — already correct.
- Matched-group vs. user-link separation — already correct after the prior fix.

## Report (to deliver in chat after implementation)

- Files inspected, current logic, where double-counting exists today (manual+manual and plaid+plaid links), the one code change that fixes all totals, and the test file covering A–E.
