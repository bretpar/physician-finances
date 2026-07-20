/**
 * Canonical repayment-plan payment computation.
 *
 * Dispatches to plan-specific formulas driven entirely by the rules
 * registry. Never fabricate fallbacks: if a plan is closed/historical or
 * ineligible for the borrower, throw `PlanUnavailableError`.
 */

import {
  computePovertyGuideline,
  latestPovertyYear,
} from "./rules/povertyGuidelines";
import {
  assertPlanSelectable,
  getPlan,
  REGISTRY_VERSION,
  type BorrowerEligibilityContext,
} from "./rules/plans";
import type {
  EligibilityStatus,
  PlanRule,
  PovertyRegion,
} from "./rules/types";

export class PlanUnavailableError extends Error {
  constructor(
    public planId: string,
    public reason: string,
    public sourceUrl?: string,
  ) {
    super(reason);
    this.name = "PlanUnavailableError";
  }
}

export interface BorrowerContext extends BorrowerEligibilityContext {
  agi: number;
  familySize: number;
  region: PovertyRegion;
  filingStatus: "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household";
  spouseAgi?: number | null;
  dependents?: number | null;
}

export interface LoanContext {
  balance: number;
  interestRatePct: number;
  additionalMonthlyPayment?: number | null;
}

export interface BreakdownStep {
  label: string;
  value: string | number;
}

export interface PaymentBreakdown {
  formula: string;
  povertyYear?: number;
  povertyGuideline?: number;
  povertyMultiplier?: number;
  incomeUsed?: number;
  spouseIncomeIncluded?: boolean;
  discretionaryIncome?: number;
  percentApplied?: number;
  dependentDeduction?: number;
  capApplied?: boolean;
  capMonthly?: number;
  termMonths?: number;
  minimumApplied?: boolean;
  steps: BreakdownStep[];
}

export interface PlanPaymentResult {
  planId: string;
  planStatus: PlanRule["status"];
  monthlyPayment: number;
  annualPayment: number;
  monthlyInterest: number;
  coversMonthlyInterest: boolean;
  breakdown: PaymentBreakdown;
  assumptions: string[];
  eligibility: EligibilityStatus;
  /** When eligibility === "assumed", the specific inputs still needed. Empty when confirmed. */
  eligibilityReasons: string[];
  rulesVersion: string;
  sourceUrl: string;
  sourceUpdatedAt: string;
  registryVersion: string;
}

// ── Amortization helpers ────────────────────────────────────────────
export function amortizedMonthlyPayment(principal: number, annualRatePct: number, months: number): number {
  const P = Math.max(0, principal);
  const n = Math.max(1, Math.floor(months));
  const r = Math.max(0, annualRatePct) / 100 / 12;
  if (P === 0) return 0;
  if (r === 0) return P / n;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}

export function monthsToPayoff(principal: number, annualRatePct: number, monthlyPayment: number): number | null {
  const P = Math.max(0, principal);
  const r = Math.max(0, annualRatePct) / 100 / 12;
  const M = Math.max(0, monthlyPayment);
  if (P === 0) return 0;
  if (M <= 0) return null;
  if (r === 0) return Math.ceil(P / M);
  if (M <= P * r) return null;
  const n = Math.log(M / (M - P * r)) / Math.log(1 + r);
  return Math.ceil(n);
}

// ── Registry-driven helpers ─────────────────────────────────────────
function selectPovertyYear(_plan: PlanRule): number {
  // FSA IDR formulas use the prior calendar year's guidelines; approximate
  // by using the latest published year available in the registry.
  return latestPovertyYear();
}

export function friendlyRegionLabel(region: PovertyRegion): string {
  switch (region) {
    case "contiguous_48_dc":
      return "48 contiguous states and Washington, D.C.";
    case "alaska":
      return "Alaska";
    case "hawaii":
      return "Hawaii";
    default:
      return String(region);
  }
}

function agiPerRules(plan: PlanRule, borrower: BorrowerContext): { amount: number; spouseIncluded: boolean } {
  if (!plan.spouseIncome) return { amount: Math.max(0, borrower.agi), spouseIncluded: false };
  const status = borrower.filingStatus;
  const rule =
    status === "married_filing_jointly" ? plan.spouseIncome.mfj
    : status === "married_filing_separately" ? plan.spouseIncome.mfs
    : "filer_only";
  if (rule === "combined") {
    return {
      amount: Math.max(0, borrower.agi) + Math.max(0, borrower.spouseAgi ?? 0),
      spouseIncluded: (borrower.spouseAgi ?? 0) > 0,
    };
  }
  return { amount: Math.max(0, borrower.agi), spouseIncluded: false };
}

function pickAgiBracketPercent(plan: PlanRule, agi: number): { percent: number; flatAnnual?: number } {
  const brackets = plan.agiBrackets ?? [];
  let match = brackets[0] ?? { minAgi: 0, percent: 0 };
  for (const b of brackets) {
    if (agi >= b.minAgi) match = b;
  }
  return { percent: match.percent, flatAnnual: match.flatAnnual };
}

function pickTieredTermMonths(plan: PlanRule, balance: number): number {
  if (plan.termMonths) return plan.termMonths;
  const steps = (plan.tieredTerm ?? []).slice().sort((a, b) => a.minBalance - b.minBalance);
  let chosen = steps[0]?.termMonths ?? 120;
  for (const step of steps) if (balance >= step.minBalance) chosen = step.termMonths;
  return chosen;
}

function roundResult(plan: PlanRule, monthly: number): number {
  if (plan.rounding === "nearest_dollar") return Math.round(monthly);
  return Math.round(monthly * 100) / 100;
}

// ── Main dispatch ───────────────────────────────────────────────────
export function computePlanPayment(
  planId: string,
  loan: LoanContext,
  borrower: BorrowerContext,
): PlanPaymentResult {
  const plan = getPlan(planId);
  if (!plan) {
    throw new PlanUnavailableError(planId, `Unknown repayment plan: ${planId}`);
  }
  if (plan.status === "closed" || plan.status === "historical") {
    throw new PlanUnavailableError(
      plan.id,
      plan.unavailableReason ?? `${plan.displayName} is not selectable.`,
      plan.sourceUrl,
    );
  }

  const eligibility = assertPlanSelectable(plan, {
    ...borrower,
    outstandingBalance: borrower.outstandingBalance ?? loan.balance,
  });
  if (!eligibility.ok) {
    throw new PlanUnavailableError(plan.id, eligibility.reasons.join(" "), plan.sourceUrl);
  }

  const balance = Math.max(0, loan.balance);
  const rate = Math.max(0, loan.interestRatePct);
  const monthlyInterest = (balance * (rate / 100)) / 12;
  const additional = Math.max(0, loan.additionalMonthlyPayment ?? 0);

  const assumptions: string[] = [];
  if (eligibility.status === "assumed") {
    assumptions.push(...eligibility.reasons);
  }

  const breakdown: PaymentBreakdown = { formula: "", steps: [] };
  let monthlyBase = 0;

  switch (plan.family) {
    case "standard":
    case "extended": {
      const months = pickTieredTermMonths(plan, balance);
      monthlyBase = amortizedMonthlyPayment(balance, rate, months);
      breakdown.formula = `Fixed amortization of $${balance.toLocaleString()} at ${rate}% over ${months} months.`;
      breakdown.termMonths = months;
      breakdown.steps.push(
        { label: "Balance", value: balance },
        { label: "Interest rate", value: `${rate}%` },
        { label: "Term (months)", value: months },
        { label: "Amortized monthly", value: roundResult(plan, monthlyBase) },
      );
      break;
    }
    case "graduated": {
      const months = plan.termMonths ?? 120;
      const std = amortizedMonthlyPayment(balance, rate, months);
      monthlyBase = Math.max(monthlyInterest, std * 0.5);
      breakdown.formula = `Graduated schedule: initial payment ≈ 50% of Standard 10-Year, stepping up every 24 months.`;
      breakdown.termMonths = months;
      breakdown.steps.push(
        { label: "Standard 10-Year payment", value: roundResult(plan, std) },
        { label: "Initial payment shown (≈50%)", value: roundResult(plan, monthlyBase) },
      );
      assumptions.push(
        "Graduated payments start lower and step up roughly every 2 years. This figure is your initial monthly payment only.",
      );
      break;
    }
    case "tiered_standard": {
      const months = pickTieredTermMonths(plan, balance);
      monthlyBase = amortizedMonthlyPayment(balance, rate, months);
      breakdown.formula = `Tiered Standard Plan: balance ${balance >= 100_000 ? "≥$100k → 25y" : balance >= 50_000 ? "$50k–<$100k → 20y" : balance >= 25_000 ? "$25k–<$50k → 15y" : "<$25k → 10y"}.`;
      breakdown.termMonths = months;
      breakdown.steps.push(
        { label: "Balance", value: balance },
        { label: "Selected term (months)", value: months },
        { label: "Amortized monthly", value: roundResult(plan, monthlyBase) },
      );
      break;
    }
    case "idr": {
      const { amount: incomeUsed, spouseIncluded } = agiPerRules(plan, borrower);
      breakdown.incomeUsed = incomeUsed;
      breakdown.spouseIncomeIncluded = spouseIncluded;

      // RAP uses AGI brackets directly (no poverty deduction).
      if (plan.agiBrackets && plan.agiBrackets.length > 0) {
        const { percent, flatAnnual } = pickAgiBracketPercent(plan, incomeUsed);
        const annual = flatAnnual != null ? flatAnnual : (incomeUsed * percent) / 100;
        const dependents = Math.max(0, borrower.dependents ?? 0);
        const deductionAnnual = Math.max(0, (plan.dependentDeductionAnnual ?? 0) * dependents);
        let monthly = Math.max(0, annual - deductionAnnual) / 12;
        const floor = plan.minPayment ?? 0;
        const minimumApplied = monthly < floor && incomeUsed > 0;
        monthly = Math.max(monthly, floor);
        monthlyBase = monthly;
        breakdown.formula = `RAP: tiered % of AGI (with $120 flat floor at ≤$10k), minus $50/dependent/month, floor $${floor}/mo.`;
        breakdown.percentApplied = percent;
        breakdown.dependentDeduction = deductionAnnual;
        breakdown.minimumApplied = minimumApplied;
        breakdown.steps.push(
          { label: "AGI used", value: incomeUsed },
          { label: "Spouse income included?", value: spouseIncluded ? "Yes (MFJ combined)" : "No (MFS filer only)" },
          { label: "Bracket %", value: `${percent}%` },
          { label: flatAnnual != null ? "Flat annual" : "Annual before deduction", value: annual },
          { label: `Dependent deduction (${dependents} × $${plan.dependentDeductionAnnual ?? 0}/yr)`, value: deductionAnnual },
          { label: "Monthly", value: roundResult(plan, monthly) },
        );
        if (minimumApplied) assumptions.push(`Payment raised to the $${floor}/month RAP floor.`);
        break;
      }

      // Discretionary-income IDR (IBR, PAYE, ICR)
      if (!plan.discretionary) {
        throw new PlanUnavailableError(plan.id, "Discretionary rule missing for IDR plan.", plan.sourceUrl);
      }
      const povertyYear = selectPovertyYear(plan);
      const { amount: guideline, table } = computePovertyGuideline(
        borrower.familySize,
        povertyYear,
        borrower.region,
      );
      const multiplier = plan.discretionary.povertyMultiplier;
      const protectedIncome = guideline * multiplier;
      const discretionary = Math.max(0, incomeUsed - protectedIncome);
      const pct = plan.idrPercent ?? 10;
      let monthly = (discretionary * (pct / 100)) / 12;
      let capApplied = false;
      let capMonthly: number | undefined;

      if (plan.cap.kind === "standard_10") {
        capMonthly = amortizedMonthlyPayment(balance, rate, 120);
        if (monthly > capMonthly) {
          monthly = capMonthly;
          capApplied = true;
        }
      } else if (plan.cap.kind === "twelve_year_income_adjusted") {
        capMonthly = amortizedMonthlyPayment(balance, rate, 144);
        if (monthly > capMonthly) {
          monthly = capMonthly;
          capApplied = true;
        }
      }

      monthlyBase = monthly;
      breakdown.formula = `${pct}% of (AGI − ${Math.round(multiplier * 100)}% × poverty guideline) ÷ 12${
        plan.cap.kind === "standard_10" ? ", capped at Standard 10-Year." :
        plan.cap.kind === "twelve_year_income_adjusted" ? ", capped by a 12-year income-adjusted schedule." : "."
      }`;
      breakdown.povertyYear = povertyYear;
      breakdown.povertyGuideline = guideline;
      breakdown.povertyMultiplier = multiplier;
      breakdown.discretionaryIncome = discretionary;
      breakdown.percentApplied = pct;
      breakdown.capApplied = capApplied;
      breakdown.capMonthly = capMonthly;
      breakdown.steps.push(
        { label: `Poverty guideline (${povertyYear}, family of ${borrower.familySize}, ${friendlyRegionLabel(table.region)})`, value: guideline },
        { label: `Protected income (${Math.round(multiplier * 100)}% of guideline)`, value: protectedIncome },
        { label: "AGI used", value: incomeUsed },
        { label: "Spouse income included?", value: spouseIncluded ? "Yes (MFJ combined)" : "No (MFS filer only)" },
        { label: "Discretionary income", value: discretionary },
        { label: `${pct}% of discretionary ÷ 12`, value: roundResult(plan, (discretionary * pct / 100) / 12) },
      );
      if (capApplied && capMonthly != null) {
        breakdown.steps.push({ label: "Cap applied", value: roundResult(plan, capMonthly) });
        assumptions.push(
          plan.cap.kind === "standard_10"
            ? "Payment capped at the Standard 10-Year amount."
            : "Payment capped by a 12-year income-adjusted schedule.",
        );
      }
      if (discretionary === 0) {
        assumptions.push(
          "Your income is at or below the protected-income floor, so the IDR payment is $0.",
        );
      }
      if (table.verification === "pending") {
        assumptions.push(
          `Poverty guideline for ${friendlyRegionLabel(table.region)} ${povertyYear} is provisional (verification pending).`,
        );
      }
      break;
    }
  }

  if (plan.verification === "pending" && plan.verificationNotes) {
    for (const n of plan.verificationNotes) assumptions.push(n);
  }

  const monthlyRaw = monthlyBase + additional;
  const monthly = roundResult(plan, monthlyRaw);
  const annual = roundResult(plan, monthly * 12);
  const coversMonthlyInterest = monthly + 0.0001 >= monthlyInterest;

  if (additional > 0) {
    breakdown.steps.push({ label: "Additional monthly payment", value: roundResult(plan, additional) });
  }

  return {
    planId: plan.id,
    planStatus: plan.status,
    monthlyPayment: monthly,
    annualPayment: annual,
    monthlyInterest: Math.round(monthlyInterest * 100) / 100,
    coversMonthlyInterest,
    breakdown,
    assumptions,
    eligibility: eligibility.status,
    eligibilityReasons: eligibility.status === "assumed" ? [...eligibility.reasons] : [],
    rulesVersion: plan.rulesVersion,
    sourceUrl: plan.sourceUrl,
    sourceUpdatedAt: plan.sourceUpdatedAt,
    registryVersion: REGISTRY_VERSION,
  };
}
