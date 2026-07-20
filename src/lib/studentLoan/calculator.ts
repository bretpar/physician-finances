/**
 * Backward-compatible calculator facade. New code should call
 * `computePlanPayment` from `./computePlanPayment` directly.
 */

import {
  computePlanPayment,
  PlanUnavailableError,
  type BorrowerContext,
  type LoanContext,
  type PlanPaymentResult,
} from "./computePlanPayment";
import { getPlan } from "./rules/plans";
import type { PovertyRegion } from "./rules/types";
import { REPAYMENT_PLANS, type RepaymentPlanDefinition } from "./repaymentPlans";

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
  annualIncome: number;
  spouseAnnualIncome?: number | null;
  dependents?: number | null;
  region?: PovertyRegion;
  ibrBorrowerType?: "new_2014" | "old" | null;
  isParentPlus?: boolean | null;
  parentPlusConsolidated?: boolean | null;
  firstDisbursementDate?: string | null;
}

export interface EstimateResult {
  plan: RepaymentPlanDefinition;
  estimatedMonthlyPayment: number;
  estimatedAnnualPayment: number;
  monthlyInterest: number;
  annualInterest: number;
  coversMonthlyInterest: boolean;
  estimatedPayoffMonths: number | null;
  discretionaryIncome?: number;
  notes: string[];
  /** Full payment breakdown from the canonical engine. Preferred for new UI. */
  detail?: PlanPaymentResult;
  /** Non-null when the plan cannot be estimated. */
  unavailable?: { reason: string; sourceUrl?: string };
}

export function aggregateLoans(loans: StudentLoanInput[]): StudentLoanInput {
  const filtered = loans.filter((l) => l.balance > 0);
  if (filtered.length === 0) return { balance: 0, interestRatePct: 0 };
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
  planId: string,
): EstimateResult {
  const planRule = getPlan(planId);
  const planDef =
    REPAYMENT_PLANS[planId] ??
    REPAYMENT_PLANS["standard_10"];

  const balance = Math.max(0, loan.balance);
  const rate = Math.max(0, loan.interestRatePct);
  const monthlyInterest = (balance * (rate / 100)) / 12;

  const notes: string[] = [];

  const loanCtx: LoanContext = {
    balance,
    interestRatePct: rate,
    additionalMonthlyPayment: loan.additionalMonthlyPayment ?? 0,
  };
  const borrowerCtx: BorrowerContext = {
    agi: borrower.annualIncome,
    familySize: Math.max(1, borrower.familySize || 1),
    region: borrower.region ?? "contiguous_48_dc",
    filingStatus: borrower.filingStatus,
    spouseAgi: borrower.spouseAnnualIncome ?? 0,
    dependents: borrower.dependents ?? Math.max(0, (borrower.familySize || 1) - 1),
    ibrBorrowerType: borrower.ibrBorrowerType,
    isParentPlus: borrower.isParentPlus,
    parentPlusConsolidated: borrower.parentPlusConsolidated,
    firstDisbursementDate: borrower.firstDisbursementDate,
  };

  try {
    const detail = computePlanPayment(planId, loanCtx, borrowerCtx);
    // Fixed-term plans: use the registry's own term, not a re-derived
    // payoff from the rounded monthly payment (which produces 121-month
    // off-by-one artifacts on Standard 10).
    // Graduated: the payment shown is the STARTING payment and the full
    // stepped schedule is not modeled — do not fabricate a payoff month
    // count from it (which would show absurd 30+ year payoffs).
    const planFamily = planRule?.family;
    let estimatedPayoffMonths: number | null;
    if (planFamily === "graduated") {
      estimatedPayoffMonths = null;
    } else if (
      planFamily === "standard" ||
      planFamily === "extended" ||
      planFamily === "tiered_standard"
    ) {
      estimatedPayoffMonths = detail.breakdown.termMonths ?? null;
    } else {
      estimatedPayoffMonths = monthsToPayoffFromRate(balance, rate, detail.monthlyPayment);
    }
    return {
      plan: planDef,
      estimatedMonthlyPayment: detail.monthlyPayment,
      estimatedAnnualPayment: detail.annualPayment,
      monthlyInterest: round2(monthlyInterest),
      annualInterest: round2(monthlyInterest * 12),
      coversMonthlyInterest: detail.coversMonthlyInterest,
      estimatedPayoffMonths,
      discretionaryIncome: detail.breakdown.discretionaryIncome,
      notes: [...detail.assumptions],
      detail,
    };
  } catch (err) {
    const unavailable =
      err instanceof PlanUnavailableError
        ? { reason: err.reason, sourceUrl: err.sourceUrl }
        : { reason: String((err as Error).message ?? err) };
    notes.push(unavailable.reason);
    return {
      plan: planDef,
      estimatedMonthlyPayment: 0,
      estimatedAnnualPayment: 0,
      monthlyInterest: round2(monthlyInterest),
      annualInterest: round2(monthlyInterest * 12),
      coversMonthlyInterest: false,
      estimatedPayoffMonths: null,
      notes,
      unavailable: {
        reason: unavailable.reason,
        sourceUrl: unavailable.sourceUrl ?? planRule?.sourceUrl,
      },
    };
  }
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function monthsToPayoffFromRate(P: number, ratePct: number, monthly: number): number | null {
  const r = Math.max(0, ratePct) / 100 / 12;
  const M = Math.max(0, monthly);
  if (P <= 0) return 0;
  if (M <= 0) return null;
  if (r === 0) return Math.ceil(P / M);
  if (M <= P * r) return null;
  return Math.ceil(Math.log(M / (M - P * r)) / Math.log(1 + r));
}
