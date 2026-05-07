/**
 * Paycheck Profile Savings Helper
 * --------------------------------------------------------------------------
 * Simple, paycheck-only savings guidance based on the user's selected tax
 * profile effective rate. This intentionally does NOT use:
 *   - annual remaining tax
 *   - quarterly catch-up logic
 *   - dynamicTaxRecommendation
 *   - quarterlyAdjustmentAmount
 *   - any per-pay-period spread of annual shortfalls
 *
 * It only answers: "Based on my selected tax profile rate, how much extra
 * should I save from THIS paycheck after payroll taxes already withheld?"
 *
 * The full annual catch-up math lives in `useWithholdingRecommendation` and
 * is exposed elsewhere (recommendation modal, dashboard). This card stays
 * deliberately simple.
 */

export type PaycheckSavingsStatus = "under_withheld" | "over_withheld" | "on_track";

export interface PaycheckProfileSavingsInput {
  /** Gross paycheck income (pre-deduction). */
  grossPaycheckIncome: number;
  /** Pre-tax deductions reducing taxable paycheck (401k, HSA, healthcare, etc.). */
  eligiblePreTaxDeductions: number;
  /**
   * Effective tax rate (PERCENT, e.g. 12.3 for 12.3%) from the user's
   * selected tax profile / withholding method.
   */
  selectedProfileEffectiveTaxRate: number;
  /**
   * Canonical Total Federal Payroll Taxes already withheld on this paycheck:
   * federal income tax + Social Security + Medicare. Pass the canonical
   * total — do NOT also add the split fields.
   */
  totalFederalPayrollTaxes: number;
  /** State withholding on this paycheck, only when state tax is enabled. */
  stateWithholdingIfEnabled: number;
  /**
   * Additional tax reserve the user manually set aside for THIS specific
   * income entry. This is NOT actual payroll withholding — it is extra money
   * earmarked for taxes for this paycheck. It reduces the per-paycheck
   * remaining-savings recommendation, but is intentionally NOT added into
   * `totalPayrollTaxesWithheld` and never spreads across other paychecks.
   */
  additionalTaxReserveForThisEntry?: number;
}

export interface PaycheckProfileSavingsResult {
  effectiveRateUsed: number;
  taxablePaycheckAmount: number;
  paycheckTaxTarget: number;
  totalPayrollTaxesWithheld: number;
  /** Per-entry reserve applied to this calculation (informational). */
  additionalTaxReserveApplied: number;
  /** Remaining savings needed = max(target − payroll withheld − reserve, 0). */
  remainingSavingsNeeded: number;
  /**
   * Signed difference: positive when more savings are still needed,
   * negative when over-saved (payroll + reserve exceeds target).
   */
  withholdingDifference: number;
  status: PaycheckSavingsStatus;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calculatePaycheckProfileSavings(
  input: PaycheckProfileSavingsInput,
): PaycheckProfileSavingsResult {
  const gross = Math.max(0, Number(input.grossPaycheckIncome) || 0);
  const deductions = Math.max(0, Number(input.eligiblePreTaxDeductions) || 0);
  const ratePct = Math.max(0, Number(input.selectedProfileEffectiveTaxRate) || 0);
  const fedPayroll = Math.max(0, Number(input.totalFederalPayrollTaxes) || 0);
  const statePayroll = Math.max(0, Number(input.stateWithholdingIfEnabled) || 0);
  const additionalReserve = Math.max(
    0,
    Number(input.additionalTaxReserveForThisEntry) || 0,
  );

  const taxablePaycheckAmount = round2(Math.max(0, gross - deductions));
  const paycheckTaxTarget = round2(taxablePaycheckAmount * (ratePct / 100));
  const totalPayrollTaxesWithheld = round2(fedPayroll + statePayroll);

  // Per-entry rule: additional tax reserve reduces the remaining savings
  // recommendation for THIS paycheck only. It is NOT added to actual
  // withholding totals and never spreads to other paychecks.
  const remainingSavingsNeeded = round2(
    Math.max(0, paycheckTaxTarget - totalPayrollTaxesWithheld - additionalReserve),
  );
  const withholdingDifference = round2(
    paycheckTaxTarget - totalPayrollTaxesWithheld - additionalReserve,
  );

  const status: PaycheckSavingsStatus =
    withholdingDifference > 0
      ? "under_withheld"
      : withholdingDifference < 0
      ? "over_withheld"
      : "on_track";

  return {
    effectiveRateUsed: ratePct,
    taxablePaycheckAmount,
    paycheckTaxTarget,
    totalPayrollTaxesWithheld,
    additionalTaxReserveApplied: round2(additionalReserve),
    remainingSavingsNeeded,
    withholdingDifference,
    status,
  };
}
