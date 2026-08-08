/**
 * Tax Savings: contribution totals vs. personally deductible amounts.
 *
 * Employer-funded contributions (employer HSA, employer 401(k) match / profit
 * sharing) count toward plan contribution totals and annual limits, but they
 * are NOT an additional deduction against the individual's taxable income —
 * the employee never paid tax on those dollars in the first place.
 *
 * Every Tax Savings surface must read `contributionTotal` for limit/tracking
 * display and `personalDeduction` for anything labelled as a deduction or
 * tax saving.
 */

export interface RetirementSavingsInput {
  /** Annualized total from standalone (self-directed) retirement contributions. */
  standaloneAnnualizedTotal: number;
  /** Employee-side (`retirement_401k`) amounts recorded on income entries. */
  paycheckEmployeeTotal: number;
  /** Employer-side (`employer_retirement_contribution`) amounts on income entries. */
  paycheckEmployerTotal: number;
}

export interface RetirementSavingsSummary {
  standaloneTotal: number;
  employeeTotal: number;
  employerTotal: number;
  /** Everything contributed to retirement plans (used for totals/limits). */
  contributionTotal: number;
  /** Only amounts that reduce the individual's taxable income. */
  personalDeduction: number;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function computeRetirementSavingsSummary(
  input: RetirementSavingsInput,
): RetirementSavingsSummary {
  const standaloneTotal = nonNeg(Number(input.standaloneAnnualizedTotal));
  const employeeTotal = nonNeg(Number(input.paycheckEmployeeTotal));
  const employerTotal = nonNeg(Number(input.paycheckEmployerTotal));

  return {
    standaloneTotal,
    employeeTotal,
    employerTotal,
    contributionTotal: standaloneTotal + employeeTotal + employerTotal,
    // Employer contributions are excluded — they never reduce personal
    // taxable income a second time.
    personalDeduction: standaloneTotal + employeeTotal,
  };
}
