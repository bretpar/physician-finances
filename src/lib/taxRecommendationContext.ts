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