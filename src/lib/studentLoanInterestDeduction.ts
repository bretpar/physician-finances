/**
 * Student loan interest deduction (IRC §221) — isolated so the phase-out
 * schedule can be expanded/updated without touching the UI or the rest of
 * the tax engine.
 *
 * Rules modeled:
 *  - Maximum deduction of $2,500 of interest paid during the year.
 *  - Phased out ratably over a MAGI range that depends on filing status.
 *  - Not allowed for married filing separately.
 *
 * MAGI here is approximated by AGI computed before this deduction, which is
 * the correct base for the vast majority of returns.
 */

export type StudentLoanFilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | string;

export const STUDENT_LOAN_INTEREST_MAX = 2500;

/** Phase-out ranges (MAGI). Update here when IRS releases new figures. */
export const STUDENT_LOAN_PHASEOUT: Record<"single" | "married_filing_jointly", { start: number; end: number }> = {
  single: { start: 85_000, end: 100_000 },
  married_filing_jointly: { start: 170_000, end: 200_000 },
};

export interface StudentLoanInterestDeductionResult {
  /** Interest entered by the user, floored at 0. */
  interestPaid: number;
  /** Interest after the $2,500 statutory cap. */
  cappedInterest: number;
  /** Fraction of the capped interest still allowed after phase-out (0..1). */
  allowedFraction: number;
  /** Final deductible amount used as an above-the-line AGI adjustment. */
  deduction: number;
  /** True when MAGI fully phased out the deduction. */
  phasedOut: boolean;
  /** True when filing status makes the deduction unavailable. */
  ineligibleFilingStatus: boolean;
}

export function computeStudentLoanInterestDeduction(params: {
  interestPaid: number;
  magi: number;
  filingStatus: StudentLoanFilingStatus;
}): StudentLoanInterestDeductionResult {
  const interestPaid = Math.max(0, Number(params.interestPaid) || 0);
  const cappedInterest = Math.min(interestPaid, STUDENT_LOAN_INTEREST_MAX);

  const ineligibleFilingStatus = params.filingStatus === "married_filing_separately";
  if (ineligibleFilingStatus || cappedInterest <= 0) {
    return {
      interestPaid, cappedInterest, allowedFraction: 0, deduction: 0,
      phasedOut: false, ineligibleFilingStatus,
    };
  }

  const range = params.filingStatus === "married_filing_jointly"
    ? STUDENT_LOAN_PHASEOUT.married_filing_jointly
    : STUDENT_LOAN_PHASEOUT.single;

  const magi = Math.max(0, Number(params.magi) || 0);
  let allowedFraction = 1;
  if (magi >= range.end) allowedFraction = 0;
  else if (magi > range.start) allowedFraction = 1 - (magi - range.start) / (range.end - range.start);

  const deduction = Math.round(cappedInterest * allowedFraction * 100) / 100;
  return {
    interestPaid, cappedInterest, allowedFraction, deduction,
    phasedOut: allowedFraction <= 0,
    ineligibleFilingStatus: false,
  };
}
