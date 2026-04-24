/**
 * Canonical helper for computing the total federal payroll taxes already paid
 * on an income entry / projected paycheck. Federal-only — state is intentionally
 * excluded (state tracking will be built separately).
 *
 * Precedence (avoids double counting):
 *   1. If `taxes_withheld` is populated and > 0, treat it as the canonical
 *      "Total Federal Payroll Taxes" total (federal income tax + SS + Medicare).
 *   2. Otherwise, if `federal_withholding` >= the SS+Medicare components,
 *      assume `federal_withholding` already represents the full federal total
 *      (the Personal Income form stores it that way today).
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
  // If the canonical fed field already includes SS+Medicare, don't double-count.
  if (fed >= ss + medicare) return fed;
  return fed + ss + medicare;
}
