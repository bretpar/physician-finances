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
   * Federal INCOME TAX withheld on this paycheck — the ONLY federal amount
   * that may reduce the recommendation. Employee Social Security and Medicare
   * are NOT part of the tax target (federal income tax + SE tax + state tax),
   * so they must never be credited here.
   */
  federalIncomeTaxWithheld?: number;
  /**
   * Employee Social Security + Medicare withheld. Informational only — stored
   * and displayed separately, never credited against the recommendation.
   */
  socialSecurityAndMedicareWithheld?: number;
  /**
   * @deprecated Total federal payroll taxes (income tax + SS + Medicare).
   * Kept for legacy callers only. When `federalIncomeTaxWithheld` is supplied
   * this value is informational. When it is NOT supplied and no SS/Medicare
   * split is known, it is used as the federal income-tax credit (legacy rows
   * stored a single undifferentiated amount).
   */
  totalFederalPayrollTaxes?: number;
  /** State withholding on this paycheck, only when state tax is enabled. */
  stateWithholdingIfEnabled: number;
  /**
   * Whether state income tax is part of the tax target driving
   * `selectedProfileEffectiveTaxRate`. State withholding is credited ONLY
   * when the target includes state tax, keeping the treatment symmetric.
   * Defaults to true (the caller already zeroes state withholding when state
   * tax is disabled).
   */
  stateTaxIncludedInTarget?: boolean;
  /**
   * Additional tax reserve the user manually set aside for THIS specific
   * income entry. This is NOT actual payroll withholding — it is extra money
   * earmarked for taxes for this paycheck. It reduces the per-paycheck
   * remaining-savings recommendation, but is intentionally NOT added into
   * `totalPayrollTaxesWithheld` and never spreads across other paychecks.
   */
  additionalTaxReserveForThisEntry?: number;
  /**
   * Prospective catch-up share for this paycheck (from
   * `computeCatchUpRecommendation().quarterlyAdjustmentAmount`). Added on top
   * of the normal profile target so a user who is behind can actually recover.
   */
  catchUpAmount?: number;
}

export interface PaycheckProfileSavingsResult {
  effectiveRateUsed: number;
  taxablePaycheckAmount: number;
  /** Profile-rate target for this paycheck (no catch-up). */
  paycheckTaxTarget: number;
  /** Catch-up dollars folded into this paycheck's recommendation. */
  catchUpApplied: number;
  /** paycheckTaxTarget + catchUpApplied. */
  totalTargetWithCatchUp: number;
  /**
   * Withholding credited against the target: federal INCOME TAX withheld plus
   * state withholding when state tax is part of the target. Excludes employee
   * SS/Medicare.
   */
  totalPayrollTaxesWithheld: number;
  /** Federal income tax portion credited (excludes SS/Medicare). */
  federalIncomeTaxCredited: number;
  /** State withholding credited (0 when state tax isn't in the target). */
  stateWithholdingCredited: number;
  /** Employee SS + Medicare withheld — informational, never credited. */
  payrollTaxesInformational: number;
  /** Per-entry reserve applied to this calculation (informational). */
  additionalTaxReserveApplied: number;
  /** Remaining savings needed = max(target + catch-up − credits − reserve, 0). */
  remainingSavingsNeeded: number;
  /**
   * Signed difference: positive when more savings are still needed,
   * negative when over-saved (credits + reserve exceed target).
   */
  withholdingDifference: number;
  status: PaycheckSavingsStatus;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pos = (v: unknown) => Math.max(0, Number(v) || 0);

/**
 * Resolve the federal INCOME TAX credit for a paycheck.
 *
 * Precedence:
 *   1. Explicit `federalIncomeTaxWithheld`.
 *   2. `totalFederalPayrollTaxes` minus a known SS/Medicare split.
 *   3. `totalFederalPayrollTaxes` as-is (legacy row, no split available).
 */
export function resolveFederalIncomeTaxCredit(input: {
  federalIncomeTaxWithheld?: number;
  socialSecurityAndMedicareWithheld?: number;
  totalFederalPayrollTaxes?: number;
}): number {
  if (input.federalIncomeTaxWithheld != null) return pos(input.federalIncomeTaxWithheld);
  const total = pos(input.totalFederalPayrollTaxes);
  const fica = pos(input.socialSecurityAndMedicareWithheld);
  if (fica > 0) return Math.max(0, round2(total - fica));
  return total;
}

export function calculatePaycheckProfileSavings(
  input: PaycheckProfileSavingsInput,
): PaycheckProfileSavingsResult {
  const gross = pos(input.grossPaycheckIncome);
  const deductions = pos(input.eligiblePreTaxDeductions);
  const ratePct = pos(input.selectedProfileEffectiveTaxRate);
  const stateIncluded = input.stateTaxIncludedInTarget !== false;
  const additionalReserve = pos(input.additionalTaxReserveForThisEntry);
  const catchUpApplied = pos(input.catchUpAmount);

  // FICA is never a credit against the federal income tax / SE tax / state
  // tax target — it is tracked and shown separately.
  const payrollTaxesInformational = pos(input.socialSecurityAndMedicareWithheld);
  const federalIncomeTaxCredited = resolveFederalIncomeTaxCredit(input);
  const stateWithholdingCredited = stateIncluded ? pos(input.stateWithholdingIfEnabled) : 0;

  const taxablePaycheckAmount = round2(Math.max(0, gross - deductions));
  const paycheckTaxTarget = round2(taxablePaycheckAmount * (ratePct / 100));
  const totalTargetWithCatchUp = round2(paycheckTaxTarget + catchUpApplied);
  const totalPayrollTaxesWithheld = round2(
    federalIncomeTaxCredited + stateWithholdingCredited,
  );

  // Per-entry rule: additional tax reserve reduces the remaining savings
  // recommendation for THIS paycheck only. It is NOT added to actual
  // withholding totals and never spreads to other paychecks.
  const withholdingDifference = round2(
    totalTargetWithCatchUp - totalPayrollTaxesWithheld - additionalReserve,
  );
  const remainingSavingsNeeded = Math.max(0, withholdingDifference);

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
    catchUpApplied: round2(catchUpApplied),
    totalTargetWithCatchUp,
    totalPayrollTaxesWithheld,
    federalIncomeTaxCredited: round2(federalIncomeTaxCredited),
    stateWithholdingCredited: round2(stateWithholdingCredited),
    payrollTaxesInformational: round2(payrollTaxesInformational),
    additionalTaxReserveApplied: round2(additionalReserve),
    remainingSavingsNeeded,
    withholdingDifference,
    status,
  };
}

