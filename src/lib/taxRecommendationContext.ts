/**
 * Remove an existing income transaction and its enrichment row before pricing
 * the draft that replaces it. This gives Add and Edit the same baseline.
 */
export function excludeIncomeTransactionFromTaxContext<
  T extends { id: string },
  E extends { linked_transaction_id?: string | null },
>(
  transactions: readonly T[],
  incomeEntries: readonly E[],
  transactionId?: string | null,
): { transactions: T[]; incomeEntries: E[] } {
  if (!transactionId) {
    return { transactions: [...transactions], incomeEntries: [...incomeEntries] };
  }

  return {
    transactions: transactions.filter((transaction) => transaction.id !== transactionId),
    incomeEntries: incomeEntries.filter((entry) => entry.linked_transaction_id !== transactionId),
  };
}

/**
 * Drop every income_entry that belongs to the transaction being edited.
 *
 * The business enrichment set is not the only place an income_entry can land:
 * depending on the company's filing type, the row written alongside a Business
 * Activity income transaction can carry `source_bucket = 'personal'`, in which
 * case it is loaded by `usePersonalIncomeEntries()` and aggregated as personal
 * income. Excluding it only from the business enrichment set left the edited
 * paycheck counted once through the personal aggregate, so reopening a saved
 * transaction priced a higher effective rate than the Add flow did for the very
 * same values. This helper keeps both buckets on one exclusion rule.
 */
export function excludeIncomeEntriesLinkedToTransaction<E extends object>(
  entries: readonly E[],
  transactionId?: string | null,
): E[] {
  if (!transactionId) return [...entries];
  return entries.filter(
    (entry) => (entry as { linked_transaction_id?: string | null }).linked_transaction_id !== transactionId,
  );
}

