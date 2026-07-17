/**
 * Canonical HSA contribution summary for a tax year.
 *
 * Every surface (Tax Overview, Deductions page, Reports, PDF, tax engine
 * cap) reads its totals from this helper so numbers never drift.
 *
 * Three canonical contribution types:
 *   • `employee_payroll` — pre-tax through the paycheck (Section 125). Reduces
 *     W-2 wages upstream; counts toward the annual limit; never re-deducted.
 *   • `employer` — funded by the employer. Excluded from the employee's wages
 *     by the employer. Counts toward the annual limit but is NOT an additional
 *     above-the-line deduction (employee already never paid tax on it).
 *   • `individual` — direct deposit outside of payroll. Above-the-line AGI
 *     deduction, capped so combined federal benefit never exceeds the limit.
 *
 * Legacy rows using `source_type` ("payroll" | "individual") are mapped to the
 * new type at read time:
 *   payroll → employee_payroll
 *   individual → individual
 * Nothing is silently misclassified — the map is deterministic 1:1.
 */

import { getApplicableHsaLimit, type HsaCoverageType } from "@/lib/hsaLimits";

export type HsaContributionType = "employee_payroll" | "employer" | "individual";
export type LegacyHsaSourceType = "payroll" | "individual";

export interface HsaContributionLike {
  amount: number;
  /** Canonical type — preferred. */
  contribution_type?: HsaContributionType;
  /** Legacy field. Used only when `contribution_type` is missing. */
  source_type?: LegacyHsaSourceType;
  /** Contribution date is used only for tax-year filtering upstream. */
  contribution_date?: string;
}

/** Resolve the canonical type from a row, honouring both new and legacy fields. */
export function resolveHsaContributionType(
  row: Pick<HsaContributionLike, "contribution_type" | "source_type">,
): HsaContributionType {
  if (row.contribution_type) return row.contribution_type;
  if (row.source_type === "payroll") return "employee_payroll";
  return "individual";
}

export interface HsaComputationInput {
  taxYear: number;
  coverage: HsaCoverageType;
  catchUpEligible: boolean;
  /** Contributions already filtered to the target tax year. */
  contributions: HsaContributionLike[];
  /**
   * Extra employer HSA total not represented in `contributions` (rare — used
   * only when the caller has a synthetic total to add on top). Prefer passing
   * employer rows via `contributions` with `contribution_type='employer'`.
   */
  employerContribution?: number;
}

export interface HsaContributionSummary {
  taxYear: number;
  coverage: HsaCoverageType;
  catchUpEligible: boolean;
  applicableLimit: number;
  // Bucketed contribution totals
  payrollEmployee: number;
  employer: number;
  individual: number;
  total: number;
  // Room + excess
  remaining: number;
  excess: number;
  // Deductibility (capped)
  deductibleTotal: number;
  deductiblePayroll: number;
  /** Employer HSA is never an additional deduction; kept explicit for reports. */
  deductibleEmployer: number;
  deductibleIndividual: number;
}

function sumBy(rows: HsaContributionLike[], type: HsaContributionType): number {
  let s = 0;
  for (const r of rows) {
    if (resolveHsaContributionType(r) !== type) continue;
    s += Math.max(0, Number(r.amount) || 0);
  }
  return s;
}

export function computeHsaContributionSummary(
  input: HsaComputationInput,
): HsaContributionSummary {
  const { taxYear, coverage, catchUpEligible, contributions, employerContribution = 0 } = input;
  const applicableLimit = getApplicableHsaLimit(taxYear, coverage, catchUpEligible);

  const payrollEmployee = sumBy(contributions, "employee_payroll");
  const individual = sumBy(contributions, "individual");
  const employer = Math.max(0, sumBy(contributions, "employer") + Math.max(0, employerContribution));
  const total = payrollEmployee + individual + employer;

  const excess = Math.max(0, total - applicableLimit);
  const remaining = Math.max(0, applicableLimit - total);

  // Payroll and employer are treated as already-excluded from wages upstream;
  // they count toward the limit but we never re-deduct them.
  const deductiblePayroll = payrollEmployee;
  const deductibleEmployer = 0;

  // Individual (above-the-line) portion capped so combined federal benefit ≤ limit.
  // Available room = limit − (payrollEmployee + employer), floored at 0.
  const roomForIndividual = Math.max(0, applicableLimit - payrollEmployee - employer);
  const deductibleIndividual = Math.min(individual, roomForIndividual);

  const deductibleTotal = deductiblePayroll + deductibleEmployer + deductibleIndividual;

  return {
    taxYear,
    coverage,
    catchUpEligible,
    applicableLimit,
    payrollEmployee,
    employer,
    individual,
    total,
    remaining,
    excess,
    deductibleTotal,
    deductiblePayroll,
    deductibleEmployer,
    deductibleIndividual,
  };
}
