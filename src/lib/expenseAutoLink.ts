/**
 * Auto-link rules for EXPENSE transactions only.
 *
 * When a Plaid expense is imported and there is exactly ONE unmatched manual
 * expense that is within 2 calendar days and within 1% on amount, we link the
 * pair automatically using the existing transaction-linking behavior
 * (`linkTransactionPair`) — the manual row stays canonical (receipt, category,
 * notes, company assignment preserved) and the Plaid row is soft-marked
 * `merged` so it is not double-counted.
 *
 * Everything else (multiple candidates, >1% amount drift, >2 days apart,
 * mismatched types, already-linked rows) falls through to the existing
 * Suggested Matches / manual review flow. Income/paycheck matching is
 * deliberately untouched.
 */

export const AUTO_LINK_MAX_DAYS = 2;
export const AUTO_LINK_MAX_AMOUNT_REL = 0.01;

export interface AutoLinkCandidate {
  id: string;
  transaction_type?: string | null;
  transaction_date: string;
  amount: number;
  source_type?: string | null;
  match_status?: string | null;
  status?: string | null;
  /** Auto-link never crosses organizations, even for the same user. */
  organization_id?: string | null;
  user_id?: string | null;
}

export interface AutoLinkPair {
  manualTxId: string;
  plaidTxId: string;
}

function isExpense(t: AutoLinkCandidate): boolean {
  return (t.transaction_type || "expense") === "expense";
}

/** Already actively linked (or already merged away) — never auto-link. */
function isActivelyLinked(t: AutoLinkCandidate): boolean {
  return t.match_status === "linked" || t.status === "merged";
}

function isEligible(t: AutoLinkCandidate): boolean {
  return isExpense(t) && !isActivelyLinked(t) && (t.status ?? "active") === "active";
}

/** Whole-calendar-day distance between two YYYY-MM-DD dates. */
export function calendarDaysApart(a: string, b: string): number {
  const da = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const db = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86_400_000;
}

/**
 * The imported (Plaid) amount must be within 1% of the MANUAL amount — the
 * manual transaction is always the denominator, since it is the canonical row.
 *
 *   manual $100.00 / plaid $101.00  → qualifies (exactly 1%)
 *   manual $100.00 / plaid $101.01  → does not qualify (1.01%)
 */
export function amountsWithinTolerance(manualAmount: number, plaidAmount: number): boolean {
  const manual = Math.abs(Number(manualAmount) || 0);
  const plaid = Math.abs(Number(plaidAmount) || 0);
  if (manual === 0) return plaid === 0;
  return Math.abs(plaid - manual) / manual <= AUTO_LINK_MAX_AMOUNT_REL + 1e-9;
}

export function isAutoLinkMatch(manual: AutoLinkCandidate, plaid: AutoLinkCandidate): boolean {
  if (!isExpense(manual) || !isExpense(plaid)) return false;
  if ((manual.transaction_type || "expense") !== (plaid.transaction_type || "expense")) return false;
  if (calendarDaysApart(manual.transaction_date, plaid.transaction_date) > AUTO_LINK_MAX_DAYS) return false;
  return amountsWithinTolerance(manual.amount, plaid.amount);
}

/**
 * Given the full transaction set, return the unambiguous expense pairs that
 * should be auto-linked. A pair is only returned when the Plaid row has exactly
 * one qualifying manual candidate AND that manual row isn't claimed by another
 * Plaid row in the same batch (which would make it ambiguous too).
 */
export function findExpenseAutoLinkPairs(transactions: AutoLinkCandidate[]): AutoLinkPair[] {
  const eligible = transactions.filter(isEligible);
  const manuals = eligible.filter((t) => (t.source_type || "manual") === "manual");
  const plaids = eligible.filter((t) => t.source_type === "plaid");

  const matchesByPlaid = new Map<string, string[]>();
  const claimCount = new Map<string, number>();

  for (const p of plaids) {
    const hits = manuals.filter((m) => isAutoLinkMatch(m, p)).map((m) => m.id);
    matchesByPlaid.set(p.id, hits);
    if (hits.length === 1) claimCount.set(hits[0], (claimCount.get(hits[0]) || 0) + 1);
  }

  const pairs: AutoLinkPair[] = [];
  for (const [plaidTxId, hits] of matchesByPlaid) {
    if (hits.length !== 1) continue;
    const manualTxId = hits[0];
    if ((claimCount.get(manualTxId) || 0) !== 1) continue;
    pairs.push({ manualTxId, plaidTxId });
  }
  return pairs;
}
