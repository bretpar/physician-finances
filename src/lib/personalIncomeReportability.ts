/**
 * Single source of truth for "is this Personal Income row separately
 * reportable in totals?" — used by Personal Income totals, Dashboard,
 * Tax Overview / useTaxEstimate, reporting, and Tax Prep PDF inputs.
 *
 * Rules (from QA lifecycle spec):
 *  - Planner / manual / payroll row (status active) → reportable
 *  - Suggested-match canonical (merged planner + bank deposit) → reportable
 *  - Imported Plaid cash-confirmation row LINKED to an active planner/manual
 *    row → NOT separately reportable (it's a shadow of the same paycheck)
 *  - Standalone imported Plaid income (no planner/manual representation) →
 *    reportable
 *  - `merged`, `deleted`, `unlinked` rows → NOT reportable
 *
 * Detection of "shadow" state relies on two conventions written by the
 * link/unlink flows in useIncomeMatching.ts:
 *   1. Row is currently participating in a link group → `status = 'merged'`
 *   2. Row was previously a merged imported cash-confirmation shadow and
 *      the group has been dissolved → `status = 'received'` but
 *      `include_in_tax_estimate = false` (and `include_in_cash_flow = false`)
 *      so it stays visible in the ledger / linking UI but does not
 *      inflate totals while it remains a shadow.
 *
 * A standalone imported row never gets `include_in_tax_estimate = false`
 * — those flags are only touched by the link/unlink flow.
 */
export interface ReportabilityRow {
  status?: string | null;
  include_in_tax_estimate?: boolean | null;
}

export function isPersonalIncomeReportable(row: ReportabilityRow): boolean {
  const status = String(row.status ?? "received").toLowerCase();
  if (status === "merged" || status === "deleted" || status === "unlinked") return false;
  if (row.include_in_tax_estimate === false) return false;
  return true;
}
