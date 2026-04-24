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

export type FederalWithholdingSource =
  | "taxes_withheld"
  | "federal_withholding"
  | "components_sum"
  | "none";

export interface FederalWithholdingDetail {
  total: number;
  source: FederalWithholdingSource;
}

export function getTotalFederalPaidDetail(
  entry: WithholdingFields | null | undefined,
): FederalWithholdingDetail {
  if (!entry) return { total: 0, source: "none" };
  const taxesWithheld = Number(entry.taxes_withheld || 0);
  const fed = Number(entry.federal_withholding || 0);
  const ss = Number(entry.ss_withholding || 0);
  const medicare = Number(entry.medicare_withholding || 0);

  if (taxesWithheld > 0) return { total: taxesWithheld, source: "taxes_withheld" };
  if (fed > 0 && fed >= ss + medicare) return { total: fed, source: "federal_withholding" };
  const sum = fed + ss + medicare;
  if (sum > 0) return { total: sum, source: "components_sum" };
  return { total: 0, source: "none" };
}

export function getTotalFederalPaid(entry: WithholdingFields | null | undefined): number {
  return getTotalFederalPaidDetail(entry).total;
}

/** Short human-readable label for the debug UI. */
export function federalSourceLabel(source: FederalWithholdingSource): string {
  switch (source) {
    case "taxes_withheld": return "taxes_withheld";
    case "federal_withholding": return "federal_withholding";
    case "components_sum": return "fed + SS + Medicare";
    case "none": return "none";
  }
}
