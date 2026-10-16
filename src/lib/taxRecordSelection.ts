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
  return t.transaction_type === "income" && !isExcludedFromBusiness(t);
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
