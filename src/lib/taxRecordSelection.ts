/**
 * Canonical record selection shared by the annual tax calculation
 * (useTaxEstimate) and the Tax Breakdown source cards (useTaxBreakdown).
 *
 * Pure helpers only — no tax math. Both callers must pick the SAME records:
 *  - Business gross comes from active income transactions that pass the
 *    canonical business-exclusion rule.
 *  - Business income_entries only ENRICH (withholding / deductions) and only
 *    when linked to one of those live transactions. A business entry whose
 *    linked transaction is merged/deleted never contributes gross.
 *  - Personal income comes from the personal-bucket actual rows the estimate
 *    already selected (merged rows are never personal or planned income).
 *  - Planned income comes only from Planner occurrences still "active" after
 *    conversion / matching against the same active business transactions.
 */
import { isExcludedFromBusiness, type BusinessExclusionFields } from "@/lib/businessExclusion";
import type { MatchableBusinessTransaction, ProjectedPaycheck } from "@/hooks/useProjectedIncome";

export interface SelectionTx extends BusinessExclusionFields {
  id: string;
  transaction_type?: string | null;
  transaction_date: string;
  amount: number | string;
  status?: string | null;
  vendor?: string | null;
  source_id?: string | null;
  origin_type?: string | null;
  origin_planner_conversion_id?: string | null;
}

export interface SelectionEntry {
  id: string;
  linked_transaction_id?: string | null;
}

/** Business income transaction counted toward canonical business gross. */
export function isCanonicalBusinessIncomeTx(t: SelectionTx): boolean {
  if (t.transaction_type !== "income") return false;
  // Merged / deleted rows are never business gross (the surviving representation is).
  if (t.status && t.status !== "active") return false;
  return !isExcludedFromBusiness(t);
}

/** income_entries that enrich business income (linked to a live canonical income tx). */
export function selectLinkedEnrichmentEntries<E extends SelectionEntry>(
  entries: readonly E[],
  txs: readonly SelectionTx[],
): E[] {
  const live = new Set(txs.filter(isCanonicalBusinessIncomeTx).map((t) => t.id));
  return entries.filter((e) => !!e.linked_transaction_id && live.has(e.linked_transaction_id));
}

/** Active business income transactions used to flag converted/matched Planner occurrences. */
export function buildMatchableBusinessIncomeTransactions(
  txs: readonly SelectionTx[],
): MatchableBusinessTransaction[] {
  return txs
    .filter((t) => t.transaction_type === "income" && t.status === "active" && !isExcludedFromBusiness(t))
    .map((t) => ({
      id: t.id,
      transaction_date: t.transaction_date,
      vendor: t.vendor || "",
      amount: Number(t.amount) || 0,
      source_id: t.source_id ?? null,
      status: t.status as string,
      transaction_type: t.transaction_type as string,
      origin_type: t.origin_type ?? null,
      origin_planner_conversion_id: t.origin_planner_conversion_id ?? null,
    }));
}

/** The exact records one canonical scope used. Read-only; for display + diagnostics. */
export interface CanonicalRecordSelection<T = any, E = any, P = any> {
  businessIncomeTransactions: T[];
  linkedEnrichmentEntries: E[];
  personalEntries: P[];
  /** All generated Planner occurrences (every matchStatus); only "active" count as planned. */
  projectedPaychecks: ProjectedPaycheck[];
}

export function plannedOccurrences(sel: Pick<CanonicalRecordSelection, "projectedPaychecks">): ProjectedPaycheck[] {
  return sel.projectedPaychecks.filter((p) => p.matchStatus === "active");
}

// ── Merge lineage: gross pay vs. bank-deposit representation ──────────────
export interface MergeLineageFinding {
  groupId: string | null;
  strandedEntryIds: string[];
  survivorTransactionId: string | null;
  status: "authoritative_gross_applied" | "ambiguous";
  countedBefore: number;
  countedAfter: number;
  missingEvidence: string[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * Shared calculation selection for merge groups whose saved gross-pay entry
 * was merged away while a net bank-deposit row survived. Returns IN-MEMORY
 * copies only — no record is changed.
 *
 * The saved gross (and the entry's deductions/withholding) becomes the
 * authoritative representation of the payment only when the lineage proves
 * it is the same economic payment:
 *   • exactly one active survivor in the group, and it is an imported deposit
 *   • exactly one stranded income entry with gross > 0
 *   • no other income entry already carries the survivor
 *   • the stranded entry's saved Net Received equals the survivor deposit
 * Otherwise the group is left exactly as counted today and flagged with the
 * missing evidence. Never picks the larger amount and never counts both.
 */
export function applyMergeLineageGross<T extends Record<string, any>, E extends Record<string, any>>(
  transactions: T[],
  incomeEntries: E[],
): { transactions: T[]; incomeEntries: E[]; findings: MergeLineageFinding[] } {
  const txById = new Map(transactions.map((t) => [t.id as string, t]));
  const byGroup = new Map<string, E[]>();
  for (const e of incomeEntries) {
    const tx = e.linked_transaction_id ? txById.get(e.linked_transaction_id) : undefined;
    if (!tx || tx.status === "active" || tx.transaction_type !== "income" || !tx.linked_group_id) continue;
    const list = byGroup.get(tx.linked_group_id) ?? [];
    list.push(e);
    byGroup.set(tx.linked_group_id, list);
  }
  const txPatch = new Map<string, number>();
  const entryRelink = new Map<string, string>();
  const findings: MergeLineageFinding[] = [];
  for (const [groupId, stranded] of byGroup) {
    const survivors = transactions.filter((t) => t.linked_group_id === groupId && t.status === "active");
    const survivor = survivors.length === 1 ? survivors[0] : null;
    const missing: string[] = [];
    if (survivors.length === 0) missing.push("no active record survives in the group");
    if (survivors.length > 1) missing.push("more than one active record survives in the group");
    if (survivor && survivor.source_type !== "plaid" && survivor.source_type !== "merged")
      missing.push("survivor is not an imported bank deposit");
    if (stranded.length !== 1) missing.push(`${stranded.length} merged income entries claim this group`);
    const entry = stranded.length === 1 ? stranded[0] : null;
    const gross = entry ? Number(entry.paycheck_amount) || 0 : 0;
    const deposit = survivor ? Math.abs(Number(survivor.amount) || 0) : 0;
    if (entry && gross <= 0) missing.push("merged entry has no saved gross pay");
    if (survivor && incomeEntries.some((e) => e.linked_transaction_id === survivor.id))
      missing.push("survivor already carries its own income entry");
    const savedDeposit = entry ? Number(entry.deposited_amount) || 0 : 0;
    if (entry && savedDeposit <= 0) missing.push("merged entry has no saved Net Received to tie it to a deposit");
    else if (entry && survivor && !near(savedDeposit, deposit))
      missing.push(`saved Net Received ${savedDeposit.toFixed(2)} does not equal surviving deposit ${deposit.toFixed(2)}`);
    const otherMembers = transactions.filter((t) => t.linked_group_id === groupId && t.status !== "active" && t.id !== entry?.linked_transaction_id);
    if (otherMembers.length > 1) missing.push(`${otherMembers.length} additional merged deposits need confirmation as components`);

    if (missing.length === 0 && entry && survivor) {
      txPatch.set(survivor.id, gross);
      entryRelink.set(entry.id, survivor.id);
      findings.push({ groupId, strandedEntryIds: [entry.id], survivorTransactionId: survivor.id, status: "authoritative_gross_applied", countedBefore: deposit, countedAfter: gross, missingEvidence: [] });
    } else {
      findings.push({ groupId, strandedEntryIds: stranded.map((e) => e.id), survivorTransactionId: survivor?.id ?? null, status: "ambiguous", countedBefore: deposit, countedAfter: deposit, missingEvidence: missing });
    }
  }
  if (txPatch.size === 0) return { transactions, incomeEntries, findings };
  return {
    transactions: transactions.map((t) => {
      const g = txPatch.get(t.id);
      return g == null ? t : ({ ...t, amount: Math.sign(Number(t.amount) || 1) * g, lineage_net_deposit: Math.abs(Number(t.amount) || 0) } as T);
    }),
    incomeEntries: incomeEntries.map((e) => {
      const to = entryRelink.get(e.id);
      return to == null ? e : ({ ...e, linked_transaction_id: to, lineage_original_transaction_id: e.linked_transaction_id } as E);
    }),
    findings,
  };
}
