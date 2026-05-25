// Canonical W-2 payroll-tax (employee FICA) calculator.
//
// This is the single source of truth for surfacing:
//   • Social Security taxable wages (capped at the annual wage base)
//   • Social Security tax (6.2% of capped wages)
//   • Medicare taxable wages (uncapped — continues beyond the SS cap)
//   • Medicare tax (1.45%) + Additional Medicare (0.9% over filing-status threshold)
//
// NOTE: For audit transparency we deliberately use *gross* W-2 wages as the
// FICA base. Pre-tax 401(k) is still subject to FICA; only Section 125
// cafeteria-plan items (HSA via payroll, qualified health premiums) are
// excluded. The UI tooltip explains this so auditors can reconcile.

import {
  SS_WAGE_BASE,
  ADDITIONAL_MEDICARE_THRESHOLD,
  type FilingStatus,
} from "./taxBrackets";

export const EMPLOYEE_SS_RATE = 0.062;
export const EMPLOYEE_MEDICARE_RATE = 0.0145;
export const ADDITIONAL_MEDICARE_RATE = 0.009;

export interface W2PayrollTaxBreakdown {
  /** Wages used for FICA (gross W-2 wages). */
  ficaWages: number;
  /** Annual Social Security wage base for the active tax year. */
  ssWageCap: number;
  /** Wages actually subject to Social Security tax — min(ficaWages, cap). */
  ssTaxableWages: number;
  /** Wages above the SS cap (informational; not SS-taxed). */
  ssWagesAboveCap: number;
  /** True when ficaWages >= ssWageCap. */
  ssCapReached: boolean;
  /** Social Security tax (employee side): ssTaxableWages * 6.2%. */
  ssTax: number;

  /** Medicare taxable wages — equals ficaWages (no cap). */
  medicareTaxableWages: number;
  /** Base Medicare tax: medicareTaxableWages * 1.45%. */
  medicareTax: number;

  /** Filing-status threshold for the 0.9% Additional Medicare Tax. */
  additionalMedicareThreshold: number;
  /** Wages above the additional-Medicare threshold. */
  additionalMedicareWages: number;
  /** Additional Medicare Tax (0.9%). */
  additionalMedicareTax: number;

  /** ssTax + medicareTax + additionalMedicareTax. */
  totalPayrollTax: number;
}

export function calcW2PayrollTax(
  ficaWagesInput: number,
  filingStatus: FilingStatus,
  opts?: { ssWageCap?: number; additionalMedicareThreshold?: number },
): W2PayrollTaxBreakdown {
  const ficaWages = Math.max(0, Number(ficaWagesInput) || 0);
  const ssWageCap = Math.max(0, opts?.ssWageCap ?? SS_WAGE_BASE);
  const addlThreshold = Math.max(
    0,
    opts?.additionalMedicareThreshold ??
      ADDITIONAL_MEDICARE_THRESHOLD[filingStatus] ??
      ADDITIONAL_MEDICARE_THRESHOLD.single,
  );

  const ssTaxableWages = Math.min(ficaWages, ssWageCap);
  const ssWagesAboveCap = Math.max(0, ficaWages - ssWageCap);
  const ssTax = ssTaxableWages * EMPLOYEE_SS_RATE;

  const medicareTaxableWages = ficaWages;
  const medicareTax = medicareTaxableWages * EMPLOYEE_MEDICARE_RATE;

  const additionalMedicareWages = Math.max(0, ficaWages - addlThreshold);
  const additionalMedicareTax = additionalMedicareWages * ADDITIONAL_MEDICARE_RATE;

  return {
    ficaWages,
    ssWageCap,
    ssTaxableWages,
    ssWagesAboveCap,
    ssCapReached: ficaWages >= ssWageCap && ssWageCap > 0,
    ssTax,
    medicareTaxableWages,
    medicareTax,
    additionalMedicareThreshold: addlThreshold,
    additionalMedicareWages,
    additionalMedicareTax,
    totalPayrollTax: ssTax + medicareTax + additionalMedicareTax,
  };
}
