/**
 * Ledger routing rules
 *
 * Single source of truth for whether an income entry belongs to the
 * Business Activity ledger or the Personal Income ledger, derived from
 * its filing/income type.
 *
 * Rules:
 *  - 1099 / Schedule C       → business
 *  - K-1 Partnership         → business
 *  - S-Corp Distribution     → business
 *  - W-2 (any flavor)        → personal
 *  - Capital gains, dividend, interest, rental, loss, other_income → personal
 *  - "other" / unknown       → personal (flexible)
 */

export type LedgerBucket = "business" | "personal";

const BUSINESS_TYPES = new Set<string>([
  "1099",
  "1099_schedule_c",
  "k1",
  "k1_partnership",
  "scorp_distribution",
]);

/** True if the given filing/income type must live in the Business ledger. */
export function isBusinessIncomeType(
  raw: string | null | undefined,
): boolean {
  if (!raw) return false;
  return BUSINESS_TYPES.has(raw.toLowerCase().trim());
}

/** Resolve the correct ledger bucket for a given filing/income type. */
export function ledgerForIncomeType(
  raw: string | null | undefined,
): LedgerBucket {
  return isBusinessIncomeType(raw) ? "business" : "personal";
}

/** Human label for display in Settings. */
export function ledgerLabel(bucket: LedgerBucket): string {
  return bucket === "business" ? "Business Activity" : "Personal Income";
}
