// Canonical W-2 payroll-tax (employee FICA) calculator.
//
// This is the single source of truth for surfacing:
//   • Social Security taxable wages (capped at the annual wage base)
//   • Social Security tax (6.2% of capped wages)
//   • Medicare taxable wages (uncapped — continues beyond the SS cap)
//   • Medicare tax (1.45%) + Additional Medicare (0.9% over filing-status threshold)
//
// FICA wages = gross W-2 wages MINUS eligible Section 125 cafeteria-plan
// deductions. Section 125 items are excluded from Social Security AND Medicare
// wages (Publication 15-B). The two eligible buckets we currently support:
//
//   1. Employee payroll HSA contributions  (`payrollHsa`)
//   2. Qualified pre-tax health / dental / vision premiums
//      (`qualifiedSection125Premiums`)
//
// Explicitly NOT subtracted (these are all FICA-taxable):
//   • Pre-tax 401(k) / 403(b) / Solo-401(k) / traditional-IRA deferrals
//   • Direct individual HSA contributions (above-the-line, not payroll)
//   • Above-the-line federal deductions (½ SE tax, SE health insurance, …)
//   • Business expenses / employer-side payroll costs
//
// See `src/test/w2PayrollTax.test.ts` for the audit fixtures.

import {
  SS_WAGE_BASE,
  ADDITIONAL_MEDICARE_THRESHOLD,
  type FilingStatus,
} from "./taxBrackets";

export const EMPLOYEE_SS_RATE = 0.062;
export const EMPLOYEE_MEDICARE_RATE = 0.0145;
export const ADDITIONAL_MEDICARE_RATE = 0.009;

export interface W2PayrollTaxBreakdown {
  /** Gross W-2 wages BEFORE Section 125 exclusions. */
  grossW2Wages: number;
  /** Total Section 125 deductions applied (payroll HSA + qualified premiums). */
  section125Deductions: number;
  /** Wages used for FICA — max(0, gross − section125Deductions). */
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

/**
 * Typed input for `calcW2PayrollTax`. Prefer this shape over the legacy
 * positional signature so callers can grow (annual limits, filing year, …)
 * without ambiguous positional arguments.
 */
export interface W2PayrollTaxInput {
  /** Gross W-2 wages before any Section 125 exclusion. */
  grossW2Wages: number;
  filingStatus: FilingStatus;
  /** Employee payroll HSA contributions (Section 125 — excluded from FICA). */
  payrollHsa?: number;
  /** Qualified pre-tax health / dental / vision premiums (Section 125). */
  qualifiedSection125Premiums?: number;
  /** Optional overrides (mostly for tests and future year rollovers). */
  ssWageCap?: number;
  additionalMedicareThreshold?: number;
}

function isInputObject(v: unknown): v is W2PayrollTaxInput {
  return (
    typeof v === "object" &&
    v !== null &&
    "grossW2Wages" in (v as Record<string, unknown>)
  );
}

/**
 * Overloaded signature so existing positional callers keep compiling. NEW
 * code should always pass the typed object.
 */
export function calcW2PayrollTax(input: W2PayrollTaxInput): W2PayrollTaxBreakdown;
export function calcW2PayrollTax(
  grossW2Wages: number,
  filingStatus: FilingStatus,
  opts?: { ssWageCap?: number; additionalMedicareThreshold?: number },
): W2PayrollTaxBreakdown;
export function calcW2PayrollTax(
  a: number | W2PayrollTaxInput,
  b?: FilingStatus,
  c?: { ssWageCap?: number; additionalMedicareThreshold?: number },
): W2PayrollTaxBreakdown {
  const input: W2PayrollTaxInput = isInputObject(a)
    ? a
    : {
        grossW2Wages: a,
        filingStatus: (b ?? "single") as FilingStatus,
        ssWageCap: c?.ssWageCap,
        additionalMedicareThreshold: c?.additionalMedicareThreshold,
      };

  const grossW2Wages = Math.max(0, Number(input.grossW2Wages) || 0);
  const payrollHsa = Math.max(0, Number(input.payrollHsa) || 0);
  const qualifiedSection125Premiums = Math.max(
    0,
    Number(input.qualifiedSection125Premiums) || 0,
  );
  const section125Deductions = payrollHsa + qualifiedSection125Premiums;
  // Never let adjusted wages go negative — mistyped deductions can't create a refund.
  const ficaWages = Math.max(0, grossW2Wages - section125Deductions);

  const ssWageCap = Math.max(0, input.ssWageCap ?? SS_WAGE_BASE);
  const addlThreshold = Math.max(
    0,
    input.additionalMedicareThreshold ??
      ADDITIONAL_MEDICARE_THRESHOLD[input.filingStatus] ??
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
    grossW2Wages,
    section125Deductions,
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
