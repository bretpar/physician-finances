/**
 * Centralized student-loan repayment plan rules.
 *
 * Add or update federal repayment rule changes HERE — never re-implement
 * a plan's math elsewhere in the app. Every consumer (calculator, MFS
 * comparison, UI dropdowns, tooltips) reads from this module.
 *
 * Values are simplifications appropriate for an MVP estimator. Numbers
 * reflect 2024/2025 federal guidance; some plans (e.g. SAVE) are subject
 * to ongoing regulatory changes.
 */

export type RepaymentPlanId =
  | "standard_10"
  | "extended_25"
  | "graduated_10"
  | "paye"
  | "ibr"
  | "icr"
  | "save"
  | "other";

export type RepaymentPlanFamily = "standard" | "extended" | "graduated" | "idr" | "other";

export interface RepaymentPlanDefinition {
  id: RepaymentPlanId;
  label: string;
  family: RepaymentPlanFamily;
  /** Amortization term in months for fixed-schedule plans (0 = N/A). */
  termMonths: number;
  /** Income-driven % of discretionary income used (0 = N/A). */
  idrPercent?: number;
  /** Discretionary income poverty-guideline multiplier for IDR (e.g. 1.5, 2.25). */
  idrPovertyMultiplier?: number;
  /** Forgiveness horizon in years (informational only for MVP). */
  forgivenessYears?: number;
  /** Concise tooltip for the plan chooser. */
  tooltip: string;
}

export const REPAYMENT_PLANS: Record<RepaymentPlanId, RepaymentPlanDefinition> = {
  standard_10: {
    id: "standard_10",
    label: "Standard 10-Year",
    family: "standard",
    termMonths: 120,
    tooltip:
      "Fixed monthly payments that fully pay off your federal loans in 10 years. Usually the fastest payoff and lowest total interest.",
  },
  extended_25: {
    id: "extended_25",
    label: "Extended (25-Year)",
    family: "extended",
    termMonths: 300,
    tooltip:
      "Fixed payments stretched over up to 25 years. Lower monthly cost but significantly more interest paid.",
  },
  graduated_10: {
    id: "graduated_10",
    label: "Graduated (10-Year)",
    family: "graduated",
    termMonths: 120,
    tooltip:
      "Payments start lower and step up roughly every two years, ending after 10 years. Useful if you expect income to grow.",
  },
  paye: {
    id: "paye",
    label: "PAYE — Pay As You Earn",
    family: "idr",
    termMonths: 0,
    idrPercent: 10,
    idrPovertyMultiplier: 1.5,
    forgivenessYears: 20,
    tooltip:
      "Income-driven: 10% of discretionary income (AGI minus 150% of the federal poverty line). Capped at the Standard 10-Year amount.",
  },
  ibr: {
    id: "ibr",
    label: "IBR — Income-Based Repayment",
    family: "idr",
    termMonths: 0,
    idrPercent: 10,
    idrPovertyMultiplier: 1.5,
    forgivenessYears: 20,
    tooltip:
      "Income-driven: 10% of discretionary income for newer borrowers, 15% for older loans. Capped at the Standard 10-Year amount.",
  },
  icr: {
    id: "icr",
    label: "ICR — Income-Contingent Repayment",
    family: "idr",
    termMonths: 0,
    idrPercent: 20,
    idrPovertyMultiplier: 1.0,
    forgivenessYears: 25,
    tooltip:
      "Income-driven: the lesser of 20% of discretionary income or a 12-year fixed payment adjusted for income.",
  },
  save: {
    id: "save",
    label: "SAVE — Saving on a Valuable Education",
    family: "idr",
    termMonths: 0,
    idrPercent: 10,
    idrPovertyMultiplier: 2.25,
    forgivenessYears: 20,
    tooltip:
      "Income-driven: 10% of discretionary income above 225% of the poverty line. SAVE rules are actively evolving — treat results as estimates.",
  },
  other: {
    id: "other",
    label: "Other / Not Sure",
    family: "other",
    termMonths: 120,
    tooltip: "Uses a standard 10-year amortization as a placeholder estimate.",
  },
};

export const REPAYMENT_PLAN_LIST: RepaymentPlanDefinition[] = [
  REPAYMENT_PLANS.standard_10,
  REPAYMENT_PLANS.extended_25,
  REPAYMENT_PLANS.graduated_10,
  REPAYMENT_PLANS.paye,
  REPAYMENT_PLANS.ibr,
  REPAYMENT_PLANS.icr,
  REPAYMENT_PLANS.save,
  REPAYMENT_PLANS.other,
];

/**
 * 2024 HHS federal poverty guidelines (48 contiguous states + DC).
 * Update annually. Alaska/Hawaii not modeled in MVP.
 */
const POVERTY_BASE = 15060;
const POVERTY_PER_ADDITIONAL = 5380;

export function federalPovertyLine(familySize: number): number {
  const size = Math.max(1, Math.floor(familySize || 1));
  return POVERTY_BASE + POVERTY_PER_ADDITIONAL * (size - 1);
}

/** Standard amortization: monthly payment for principal P at annual APR over N months. */
export function amortizedMonthlyPayment(principal: number, annualRatePct: number, months: number): number {
  const P = Math.max(0, principal);
  const n = Math.max(1, Math.floor(months));
  const r = Math.max(0, annualRatePct) / 100 / 12;
  if (P === 0) return 0;
  if (r === 0) return P / n;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}

/** Months to payoff at a given monthly payment. Returns null if payment can't cover interest. */
export function monthsToPayoff(principal: number, annualRatePct: number, monthlyPayment: number): number | null {
  const P = Math.max(0, principal);
  const r = Math.max(0, annualRatePct) / 100 / 12;
  const M = Math.max(0, monthlyPayment);
  if (P === 0) return 0;
  if (M <= 0) return null;
  if (r === 0) return Math.ceil(P / M);
  if (M <= P * r) return null; // payment doesn't cover monthly interest
  const n = Math.log(M / (M - P * r)) / Math.log(1 + r);
  return Math.ceil(n);
}
