/**
 * Canonical HSA contribution summary for a tax year.
 *
 * Every surface (Tax Overview, Deductions page, Reports, PDF, tax engine
 * cap) reads its totals from this helper so numbers never drift.
 *
 * Deduction rules:
 *   - Payroll HSA already reduces W-2 wages upstream (Section 125). It is
 *     NOT re-deducted; we simply count it toward the annual limit.
 *   - Employer HSA is excluded from wages by the employer. Currently 0
 *     until employer contribution ingestion ships. Reserved parameter.
 *   - Direct/individual HSA is an above-the-line AGI deduction, and IS
 *     capped so the combined federal benefit (payroll + employer +
 *     individual) never exceeds the applicable annual limit.
 *   - If payroll alone already meets or exceeds the limit, individual
 *     contributions are entirely excess — deductibleIndividual = 0. We do
 *     NOT create a negative deduction; the excess is surfaced separately.
 */

import { getApplicableHsaLimit, type HsaCoverageType } from "@/lib/hsaLimits";

export interface HsaContributionLike {
  amount: number;
  source_type: "payroll" | "individual";
  /** Contribution date is used only for tax-year filtering upstream. */
  contribution_date?: string;
}

export interface HsaComputationInput {
  taxYear: number;
  coverage: HsaCoverageType;
  catchUpEligible: boolean;
  /** Contributions already filtered to the target tax year. */
  contributions: HsaContributionLike[];
  /** Employer HSA total (currently always 0 — reserved for future). */
  employerContribution?: number;
}

export interface HsaContributionSummary {
  taxYear: number;
  coverage: HsaCoverageType;
  catchUpEligible: boolean;
  applicableLimit: number;
  // Bucketed contribution totals
  payrollEmployee: number;
  individual: number;
  employer: number;
  total: number;
  // Room + excess
  remaining: number;
  excess: number;
  // Deductibility (capped)
  deductibleTotal: number;
  deductiblePayroll: number;
  deductibleIndividual: number;
}

function sumBy(rows: HsaContributionLike[], source: "payroll" | "individual"): number {
  let s = 0;
  for (const r of rows) {
    if (r.source_type !== source) continue;
    s += Math.max(0, Number(r.amount) || 0);
  }
  return s;
}

export function computeHsaContributionSummary(
  input: HsaComputationInput,
): HsaContributionSummary {
  const { taxYear, coverage, catchUpEligible, contributions, employerContribution = 0 } = input;
  const applicableLimit = getApplicableHsaLimit(taxYear, coverage, catchUpEligible);

  const payrollEmployee = sumBy(contributions, "payroll");
  const individual = sumBy(contributions, "individual");
  const employer = Math.max(0, employerContribution);
  const total = payrollEmployee + individual + employer;

  const excess = Math.max(0, total - applicableLimit);
  const remaining = Math.max(0, applicableLimit - total);

  // Payroll is treated as already-deducted upstream; it counts toward the
  // limit but we never zero it out (that would re-add it back to W-2 wages).
  const deductiblePayroll = payrollEmployee;

  // Individual (above-the-line) portion capped so combined deductible ≤ limit.
  // Available room = limit − (payrollEmployee + employer), floored at 0.
  const roomForIndividual = Math.max(0, applicableLimit - payrollEmployee - employer);
  const deductibleIndividual = Math.min(individual, roomForIndividual);

  const deductibleTotal = Math.min(applicableLimit, deductiblePayroll + employer + deductibleIndividual);

  return {
    taxYear,
    coverage,
    catchUpEligible,
    applicableLimit,
    payrollEmployee,
    individual,
    employer,
    total,
    remaining,
    excess,
    deductibleTotal,
    deductiblePayroll,
    deductibleIndividual,
  };
}
