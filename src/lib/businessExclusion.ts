/**
 * Canonical "exclude from business" rule.
 *
 * A transaction is treated as personal / non-business and MUST NOT contribute
 * to taxable business income, deductible business expense, or any business
 * report total when ANY of the following are true:
 *
 *  1. `excluded_from_reports === true` — explicit user/system exclusion
 *     (e.g. account transfers, owner draws, bulk-marked personal expenses).
 *  2. `category === "Personal"` — personal-category expense rule. Personal
 *     income shouldn't normally exist; if it does, it's still excluded.
 *  3. `transaction_type === "transfer"` — transfers are never business
 *     income or expense.
 *
 * All business income / expense / tax aggregations across the app must use
 * `isExcludedFromBusiness` (or filter via `keepBusinessOnly`) so that the
 * dashboard, ledger, tax breakdown, estimator, and exported reports stay
 * consistent.
 */

export const PERSONAL_CATEGORY = "Personal";

export interface BusinessExclusionFields {
  excluded_from_reports?: boolean | null;
  category?: string | null;
  transaction_type?: string | null;
}

export function isExcludedFromBusiness(
  tx: BusinessExclusionFields | null | undefined,
): boolean {
  if (!tx) return true;
  if (tx.excluded_from_reports === true) return true;
  if (tx.transaction_type === "transfer") return true;
  if ((tx.category || "").trim() === PERSONAL_CATEGORY) return true;
  return false;
}

export function keepBusinessOnly<T extends BusinessExclusionFields>(
  txs: readonly T[] | null | undefined,
): T[] {
  if (!txs) return [];
  return txs.filter((t) => !isExcludedFromBusiness(t));
}
