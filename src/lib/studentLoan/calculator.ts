/**
 * Student Loan payment estimator (MVP).
 *
 * ISOLATED from the tax engine: this module never mutates or duplicates
 * tax calculations. When tax figures are needed (e.g. for the MFS
 * comparison), callers request them from `src/lib/taxEngine.ts` and pass
 * the results in.
 *
 * Future extension points (see repaymentPlans.ts and the loan data model):
 *  - Multiple loans / weighted-average rate
 *  - Federal vs private loans
 *  - PSLF / IDR history and forgiveness projections
 *  - Interest capitalization events
 *  - Multi-year forecasting with income growth + inflation
 */

import {
  REPAYMENT_PLANS,
  amortizedMonthlyPayment,
  federalPovertyLine,
  monthsToPayoff,
  type RepaymentPlanDefinition,
  type RepaymentPlanId,
} from "./repaymentPlans";

export interface StudentLoanInput {
  balance: number;
  interestRatePct: number;
  currentMonthlyPayment?: number | null;
  additionalMonthlyPayment?: number | null;
  monthsInRepayment?: number | null;
}

export interface BorrowerInput {
  filingStatus: "single" | "married_filing_jointly" | "married_filing_separately";
  familySize: number;
  /** Borrower's own annual income for IDR (may be MFS-split). */
  annualIncome: number;
}

export interface EstimateResult {
  plan: RepaymentPlanDefinition;
  estimatedMonthlyPayment: number;
  estimatedAnnualPayment: number;
  monthlyInterest: number;
  annualInterest: number;
  coversMonthlyInterest: boolean;
  estimatedPayoffMonths: number | null;
  /** For IDR plans — the discretionary income used in the calc. */
  discretionaryIncome?: number;
  notes: string[];
}

/**
 * Aggregate one or more loans into a single view. MVP: sum balances and
 * compute a balance-weighted average interest rate.
 */
export function aggregateLoans(loans: StudentLoanInput[]): StudentLoanInput {
  const filtered = loans.filter((l) => l.balance > 0);
  if (filtered.length === 0) {
    return { balance: 0, interestRatePct: 0 };
  }
  if (filtered.length === 1) return filtered[0];
  const totalBalance = filtered.reduce((s, l) => s + l.balance, 0);
  const weightedRate =
    filtered.reduce((s, l) => s + l.balance * l.interestRatePct, 0) / (totalBalance || 1);
  return {
    balance: totalBalance,
    interestRatePct: weightedRate,
    currentMonthlyPayment: filtered.reduce((s, l) => s + (l.currentMonthlyPayment ?? 0), 0) || null,
    additionalMonthlyPayment: filtered.reduce((s, l) => s + (l.additionalMonthlyPayment ?? 0), 0) || null,
  };
}

export function estimateRepayment(
  loan: StudentLoanInput,
  borrower: BorrowerInput,
  planId: RepaymentPlanId,
): EstimateResult {
  const plan = REPAYMENT_PLANS[planId] ?? REPAYMENT_PLANS.standard_10;
  const notes: string[] = [];
  const balance = Math.max(0, loan.balance);
  const rate = Math.max(0, loan.interestRatePct);
  const monthlyInterest = (balance * (rate / 100)) / 12;
  const additional = Math.max(0, loan.additionalMonthlyPayment ?? 0);

  let basePayment = 0;
  let discretionary: number | undefined;

  if (plan.family === "standard" || plan.family === "extended" || plan.family === "other") {
    basePayment = amortizedMonthlyPayment(balance, rate, plan.termMonths);
  } else if (plan.family === "graduated") {
    // Graduated MVP: start at ~50% of standard, step up every 24 months.
    // For headline monthly estimate we show the initial payment; total is
    // approximated by amortization over the same term.
    const standard = amortizedMonthlyPayment(balance, rate, plan.termMonths);
    basePayment = Math.max(monthlyInterest, standard * 0.5);
    notes.push(
      "Graduated payments start lower and step up roughly every 2 years. This estimate shows your initial monthly payment.",
    );
  } else if (plan.family === "idr") {
    const pct = (plan.idrPercent ?? 10) / 100;
    const multiplier = plan.idrPovertyMultiplier ?? 1.5;
    const poverty = federalPovertyLine(borrower.familySize);
    discretionary = Math.max(0, borrower.annualIncome - poverty * multiplier);
    const idrAnnual = discretionary * pct;
    let idrMonthly = idrAnnual / 12;
    // Standard 10-year cap for PAYE/IBR (SAVE and ICR handled below).
    if (plan.id === "paye" || plan.id === "ibr") {
      const cap = amortizedMonthlyPayment(balance, rate, 120);
      if (idrMonthly > cap) {
        idrMonthly = cap;
        notes.push("Payment is capped at the Standard 10-Year amount.");
      }
    }
    if (plan.id === "icr") {
      // Lesser of 20% discretionary or a 12-year adjusted schedule.
      const twelveYr = amortizedMonthlyPayment(balance, rate, 144);
      idrMonthly = Math.min(idrMonthly, twelveYr);
    }
    basePayment = idrMonthly;
    if (discretionary === 0) {
      notes.push("Your income is at or below the discretionary-income floor, so your IDR payment is $0.");
    }
    notes.push(
      `Uses ${(pct * 100).toFixed(0)}% of discretionary income (income minus ${(multiplier * 100).toFixed(0)}% of the federal poverty line for a family of ${borrower.familySize}).`,
    );
  }

  const estimatedMonthly = basePayment + additional;
  const coversMonthlyInterest = estimatedMonthly + 0.0001 >= monthlyInterest;
  const payoffMonths = monthsToPayoff(balance, rate, estimatedMonthly);

  if (!coversMonthlyInterest) {
    notes.push(
      "Your estimated monthly payment does not fully cover monthly interest, so your balance will grow.",
    );
  }

  return {
    plan,
    estimatedMonthlyPayment: round2(estimatedMonthly),
    estimatedAnnualPayment: round2(estimatedMonthly * 12),
    monthlyInterest: round2(monthlyInterest),
    annualInterest: round2(monthlyInterest * 12),
    coversMonthlyInterest,
    estimatedPayoffMonths: payoffMonths,
    discretionaryIncome: discretionary,
    notes,
  };
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
