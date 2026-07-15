/**
 * Shared helper: decide whether an `income_entries` row's
 * `linked_transaction_id` should be treated as an orphan by the tax
 * reconciliation logic.
 *
 * Rules (single source of truth used by useTaxEstimate):
 *  - Row with no `linked_transaction_id` → NOT an orphan (unlinked is fine).
 *  - Row with `linked_transaction_id` that matches a live `transactions.id`
 *    → NOT an orphan.
 *  - Row with `linked_transaction_id` that matches a `plaid_transactions.id`
 *    → NOT an orphan (personal Plaid-imported deposits that never got
 *    promoted into the canonical transactions table).
 *  - Row with `linked_transaction_id` that matches neither table → orphan.
 */
export interface OrphanCheckRow {
  linked_transaction_id?: string | null;
}

export function isOrphanIncomeEntry(
  row: OrphanCheckRow,
  liveTransactionIds: ReadonlySet<string>,
  plaidTransactionIds: ReadonlySet<string>,
): boolean {
  if (!row.linked_transaction_id) return false;
  if (liveTransactionIds.has(row.linked_transaction_id)) return false;
  if (plaidTransactionIds.has(row.linked_transaction_id)) return false;
  return true;
}

export function filterNonOrphanIncomeEntries<T extends OrphanCheckRow>(
  rows: readonly T[],
  liveTransactionIds: ReadonlySet<string>,
  plaidTransactionIds: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => !isOrphanIncomeEntry(r, liveTransactionIds, plaidTransactionIds));
}
