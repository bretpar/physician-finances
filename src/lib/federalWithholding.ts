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
 * Federal INCOME TAX withheld only — Social Security and Medicare excluded.
 *
 * Use this (never `getTotalFederalPaid`) whenever the number is a **credit
 * against federal income-tax liability**: counted credits, remaining tax due,
 * projected shortage, quarterly "Paid", and "Covered so far". W-2 payroll
 * SS/Medicare are settled through payroll and are not income-tax credits.
 *
 * `getTotalFederalPaid()` keeps its meaning (total federal payroll taxes) for
 * payroll-tax reporting and informational display.
 *
 * Precedence:
 *   1. If either SS or Medicare is populated, the split fields exist, so
 *      `federal_withholding` is unambiguously income tax only.
 *   2. Otherwise, if `federal_withholding` is populated, use it.
 *   3. Otherwise fall back to `taxes_withheld` — a legacy row that stored a
 *      single amount with no split available.
 */
export function getFederalIncomeTaxWithheld(
  entry: WithholdingFields | null | undefined,
): number {
  if (!entry) return 0;
  const fed = Number(entry.federal_withholding || 0);
  const ss = Number(entry.ss_withholding || 0);
  const medicare = Number(entry.medicare_withholding || 0);
  const total = Number(entry.taxes_withheld || 0);
  if (ss > 0 || medicare > 0) return Math.max(0, fed);
  if (fed > 0) return fed;
  return Math.max(0, total);
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

/**
 * Canonical reader for the Total Federal Payroll Taxes value used across
 * forms, calculations, and display.
 *
 * Precedence:
 *   1. The unified UI/form field `total_federal_payroll_taxes` if populated (>0).
 *   2. Otherwise, fall back to `getTotalFederalPaid()` which handles
 *      `taxes_withheld` (canonical DB total) and legacy split fields.
 *
 * Pass any object that may include some/all of these fields:
 *   - total_federal_payroll_taxes (form-only)
 *   - taxes_withheld (DB canonical)
 *   - federal_withholding, ss_withholding, medicare_withholding (split)
 *
 * Use this everywhere you previously did:
 *   `num(form.total_federal_payroll_taxes) > 0 ? ... : getTotalFederalPaid(...)`
 */
export interface CanonicalFederalFields extends WithholdingFields {
  total_federal_payroll_taxes?: number | string | null;
}

export function getCanonicalTotalFederalPayrollTaxes(
  source: CanonicalFederalFields | null | undefined,
): number {
  if (!source) return 0;
  const raw = source.total_federal_payroll_taxes;
  const formTotal = Number(raw ?? 0);
  if (Number.isFinite(formTotal) && formTotal > 0) return formTotal;
  return getTotalFederalPaid(source);
}

