/**
 * Canonical helper for the "Total Federal Payroll Taxes" concept used across
 * the app (Personal Income, Business Activity, Income Planner, Dashboard,
 * Tax Breakdown, Recommendations, Transaction Matching).
 *
 * Field meanings (federal-only — state withholding is intentionally separate):
 *   federal_withholding  = federal income tax withheld only
 *   ss_withholding       = Social Security withheld
 *   medicare_withholding = Medicare withheld
 *   taxes_withheld       = TOTAL federal payroll taxes paid
 *                          = federal_withholding + ss_withholding + medicare_withholding
 *   state_withholding    = state withholding only (NOT included here)
 *
 * UI form-only field:
 *   total_federal_payroll_taxes  = the visible "Total Federal Payroll Taxes"
 *                                  input. On save, this value is written to
 *                                  `taxes_withheld` (canonical total).
 *
 * `getTotalFederalPaid()` is the ONE read path the rest of the app must use
 * when it needs the total federal payroll tax amount paid on an entry.
 *
 * Precedence (avoids double counting AND preserves legacy rows):
 *   1. If `taxes_withheld` is populated and > 0, treat it as the canonical
 *      total (federal income tax + SS + Medicare). This is the new source
 *      of truth for all rows saved by current form code.
 *   2. Otherwise, if `federal_withholding` >= the SS+Medicare components,
 *      assume `federal_withholding` legacy-rows already represent the full
 *      federal total (older Personal Income entries stored it that way).
 *   3. Otherwise, sum the components: federal_withholding + ss + medicare.
 *
 * This keeps:
 *   - new entries (taxes_withheld populated) accurate
 *   - legacy rows with only federal_withholding populated working
 *   - rows with split SS/Medicare backward-compatible
 */
export interface WithholdingFields {
  taxes_withheld?: number | null;
  federal_withholding?: number | null;
  ss_withholding?: number | null;
  medicare_withholding?: number | null;
}

export function getTotalFederalPaid(entry: WithholdingFields | null | undefined): number {
  if (!entry) return 0;
  const taxesWithheld = Number(entry.taxes_withheld || 0);
  const fed = Number(entry.federal_withholding || 0);
  const ss = Number(entry.ss_withholding || 0);
  const medicare = Number(entry.medicare_withholding || 0);

  if (taxesWithheld > 0) return taxesWithheld;
  // If the canonical fed field already includes SS+Medicare (legacy rows),
  // don't double-count.
  if (fed >= ss + medicare) return fed;
  return fed + ss + medicare;
}

/**
 * Build the canonical "Total Federal Payroll Taxes" total from split form
 * components. Used by save handlers to derive the value written to
 * `taxes_withheld`.
 */
export function buildTotalFederalPayrollTaxes(parts: {
  federal_withholding?: number | string | null;
  ss_withholding?: number | string | null;
  medicare_withholding?: number | string | null;
}): number {
  const n = (v: number | string | null | undefined) => {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
  };
  return n(parts.federal_withholding) + n(parts.ss_withholding) + n(parts.medicare_withholding);
}
