/**
 * Bridges the two transaction views the tax estimate needs:
 *   • transactionHistory — every row (active + merged …), read-only, used ONLY
 *     to see merge lineage (which merged parent a stranded entry belongs to).
 *   • activeTransactions — the counted set. Merged rows never enter it.
 *
 * Returns the counted set with lineage applied (in-memory copies only).
 */
import { applyMergeLineageGross, type MergeLineageFinding } from "@/lib/taxRecordSelection";

type Row = Record<string, any>;

export function resolveLineageForTaxContext<T extends Row, E extends Row>(args: {
  activeTransactions: T[];
  transactionHistory: Row[] | undefined;
  /** Raw income entries (before the active-only orphan filter). */
  allIncomeEntries: E[];
  /** Income entries already selected for counting (orphan-filtered, deduped). */
  countedIncomeEntries: E[];
  confirmedGroupIds?: ReadonlySet<string>;
}): { transactions: T[]; incomeEntries: E[]; findings: MergeLineageFinding[] } {
  const history = args.transactionHistory && args.transactionHistory.length ? args.transactionHistory : args.activeTransactions;
  // Merged income entries (resolved via income_entry_links) are never stranded gross-pay candidates.
  const candidates = args.allIncomeEntries.filter((e) => e.status !== "merged");
  const res = applyMergeLineageGross(history as Row[], candidates as Row[], { confirmedGroupIds: args.confirmedGroupIds });

  const patchedTx = new Map<string, Row>();
  for (const t of res.transactions) if ((t as Row).lineage_net_deposit != null) patchedTx.set(t.id, t);
  const transactions = patchedTx.size
    ? args.activeTransactions.map((t) => (patchedTx.get(t.id) as T | undefined) ?? t)
    : args.activeTransactions;

  const resultIds = new Set(res.incomeEntries.map((e) => e.id as string));
  const dropped = new Set(candidates.filter((e) => !resultIds.has(e.id)).map((e) => e.id as string));
  const relinked = new Map<string, E>();
  for (const e of res.incomeEntries) if ((e as Row).lineage_original_transaction_id) relinked.set(e.id, e as E);

  if (!dropped.size && !relinked.size) return { transactions, incomeEntries: args.countedIncomeEntries, findings: res.findings };
  const counted = args.countedIncomeEntries.filter((e) => !dropped.has(e.id)).map((e) => relinked.get(e.id) ?? e);
  const countedIds = new Set(counted.map((e) => e.id as string));
  // Stranded gross entries were dropped as "orphans" by the active-only filter;
  // once confirmed they come back exactly once, linked to the active deposit.
  for (const [id, e] of relinked) if (!countedIds.has(id)) counted.push(e);
  return { transactions, incomeEntries: counted, findings: res.findings };
}
