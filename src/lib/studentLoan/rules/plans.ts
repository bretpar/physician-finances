/**
 * Canonical registry of Federal Student Aid repayment plans as of July 2026.
 *
 * SOURCES (verified July 2026):
 *  - studentaid.gov/manage-loans/repayment/plans
 *  - studentaid.gov/announcements-events/big-updates/definitions (last updated 2026-07-06)
 *  - "Reimagining and Improving Student Education" Final Rule,
 *    Federal Register 2026-05-01, FR Doc. 2026-08556
 *  - One Big Beautiful Bill Act (OBBBA), P.L. 119-21, signed 2025-07-04
 *  - DCL GEN-25-04 (fsapartners.ed.gov, 2025-07-18)
 *  - ED press release "Next Steps for Borrowers Enrolled in the Unlawful SAVE Plan" (2026-03-27)
 *
 * Never add plan math outside this registry. Every rule below must cite its
 * `sourceUrl` and record `sourceUpdatedAt` when it was verified.
 */

import type { PlanRule } from "./types";

export const REGISTRY_VERSION = "2026.07.06";
const SA_PLANS = "https://studentaid.gov/manage-loans/repayment/plans";
const SA_BIG = "https://studentaid.gov/announcements-events/big-updates/definitions";
const OBBBA_FR = "https://www.federalregister.gov/documents/2026/05/01/2026-08556";
const SAVE_TERMINATION = "https://www.ed.gov/news/press-releases/2026-03-27-save-plan-next-steps";

// Common eligible-loan-type shorthand.
const ALL_FEDERAL = [
  "direct_subsidized",
  "direct_unsubsidized",
  "direct_plus_student",
  "direct_plus_parent",
  "direct_consolidation",
  "ffel_stafford",
  "ffel_plus",
  "ffel_consolidation",
];

export const PLANS: PlanRule[] = [
  // ─── STANDARD 10-YEAR ─────────────────────────────────────────────
  {
    id: "standard_10",
    displayName: "Standard 10-Year",
    status: "current",
    family: "standard",
    effectiveStart: "1965-11-08",
    eligibleLoanTypes: ALL_FEDERAL,
    borrowerEligibility: {},
    termMonths: 120,
    cap: { kind: "none" },
    minPayment: 50,
    rounding: "nearest_cent",
    forgivenessMonths: undefined,
    pslfEligible: true,
    tooltip:
      "Fixed monthly payments that fully pay off your federal loans in 10 years. Usually the fastest payoff and lowest total interest.",
    description:
      "Fixed amortization over 10 years (120 months). Available to all federal loan types. Base plan for PSLF.",
    sourceUrl: SA_PLANS,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── GRADUATED ────────────────────────────────────────────────────
  {
    id: "graduated_10",
    displayName: "Graduated (10-Year)",
    status: "current",
    family: "graduated",
    eligibleLoanTypes: ALL_FEDERAL,
    borrowerEligibility: {},
    termMonths: 120,
    cap: { kind: "none" },
    minPayment: 25,
    rounding: "nearest_cent",
    tooltip:
      "Payments start lower and step up roughly every two years, ending after 10 years (10–30 years for Consolidation).",
    description:
      "Payments begin low, then increase every 24 months. Payoff in 10 years for non-Consolidation loans (up to 30 years for Consolidation).",
    sourceUrl: SA_PLANS,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── EXTENDED ─────────────────────────────────────────────────────
  {
    id: "extended_25",
    displayName: "Extended (25-Year)",
    status: "current",
    family: "extended",
    eligibleLoanTypes: ALL_FEDERAL,
    borrowerEligibility: { minOutstandingBalance: 30_000 },
    termMonths: 300,
    cap: { kind: "none" },
    minPayment: 50,
    rounding: "nearest_cent",
    tooltip:
      "Fixed or graduated payments over up to 25 years. Requires more than $30,000 in outstanding Direct or FFEL loans.",
    description:
      "Fixed or graduated amortization over up to 25 years. Requires more than $30,000 outstanding in Direct or FFEL loans.",
    sourceUrl: SA_PLANS,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── TIERED STANDARD PLAN (new, effective 2026-07-01) ────────────
  {
    id: "tiered_standard",
    displayName: "Tiered Standard Plan",
    status: "current",
    family: "tiered_standard",
    effectiveStart: "2026-07-01",
    eligibleLoanTypes: ["direct_subsidized", "direct_unsubsidized", "direct_plus_student", "direct_plus_parent", "direct_consolidation"],
    borrowerEligibility: {},
    tieredTerm: [
      { minBalance: 0, termMonths: 120 },
      { minBalance: 25_000, termMonths: 180 },
      { minBalance: 50_000, termMonths: 240 },
      { minBalance: 100_000, termMonths: 300 },
    ],
    cap: { kind: "none" },
    minPayment: 50,
    rounding: "nearest_cent",
    pslfEligible: false,
    tooltip:
      "New fixed-payment plan effective July 1, 2026. Term is set by loan balance: <$25k → 10 yr, $25k–<$50k → 15 yr, $50k–<$100k → 20 yr, ≥$100k → 25 yr. Not PSLF-eligible.",
    description:
      "Mandatory default when a borrower doesn't choose a plan and the loan was first disbursed on/after 2026-07-01. Term tiers by balance. Not PSLF-qualifying.",
    sourceUrl: `${SA_BIG}#tiered-standard`,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── RAP (Repayment Assistance Plan) — new IDR, effective 2026-07-01 ─
  {
    id: "rap",
    displayName: "RAP — Repayment Assistance Plan",
    status: "current",
    family: "idr",
    effectiveStart: "2026-07-01",
    eligibleLoanTypes: ["direct_subsidized", "direct_unsubsidized", "direct_plus_student", "direct_consolidation"],
    borrowerEligibility: { parentPlusIneligible: true },
    // RAP uses AGI directly (no poverty deduction); dependents get a flat monthly $50 (annual $600) deduction.
    agiBrackets: [
      { minAgi: 0, percent: 0, flatAnnual: 120 }, // ≤$10k → $120/yr flat
      { minAgi: 10_000, percent: 1 },
      { minAgi: 20_000, percent: 2 },
      { minAgi: 30_000, percent: 3 },
      { minAgi: 40_000, percent: 4 },
      { minAgi: 50_000, percent: 5 },
      { minAgi: 60_000, percent: 6 },
      { minAgi: 70_000, percent: 7 },
      { minAgi: 80_000, percent: 8 },
      { minAgi: 90_000, percent: 9 },
      { minAgi: 100_000, percent: 10 },
    ],
    dependentDeductionAnnual: 600, // $50/mo × 12
    spouseIncome: { mfj: "combined", mfs: "filer_only" },
    cap: { kind: "none" },
    minPayment: 10,
    rounding: "nearest_dollar",
    forgivenessMonths: 360, // 30 years / 360 qualifying payments
    pslfEligible: true,
    tooltip:
      "Repayment Assistance Plan. Tiered percentage of AGI (0–10%) minus $50/dependent/month, floor $10/month. 30-year forgiveness. Parent PLUS ineligible.",
    description:
      "Mandatory IDR plan for loans first disbursed on/after 2026-07-01. Payment = (tiered % of AGI ÷ 12) − ($50 × dependents), floor $10/month. MFJ = combined AGI; MFS = filer only. Parent PLUS loans (and consolidations that repaid a Parent PLUS) are ineligible.",
    sourceUrl: `${SA_BIG}#rap`,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── IBR — new borrower on/after 2014-07-01 (10%, 20-yr) ─────────
  {
    id: "ibr_new",
    displayName: "IBR — Income-Based Repayment (new borrower)",
    status: "legacy",
    family: "idr",
    eligibleLoanTypes: ["direct_subsidized", "direct_unsubsidized", "direct_plus_student", "direct_consolidation", "ffel_stafford", "ffel_plus", "ffel_consolidation"],
    borrowerEligibility: {
      requiresBorrowerType: "new_2014",
      excludesFirstDisbursementOnOrAfter: "2026-07-01",
      parentPlusIneligible: true,
    },
    discretionary: { povertyMultiplier: 1.5 },
    idrPercent: 10,
    spouseIncome: { mfj: "combined", mfs: "filer_only" },
    cap: { kind: "standard_10" },
    minPayment: 0,
    rounding: "nearest_cent",
    forgivenessMonths: 240,
    pslfEligible: true,
    tooltip:
      "IBR for 'new' borrowers (no outstanding federal loan balance as of 2014-07-01). 10% of discretionary income, capped at the Standard 10-Year amount. 20-year forgiveness.",
    description:
      "For borrowers who had no outstanding Direct/FFEL loan balance on 2014-07-01. Payment = 10% × (AGI − 150% × poverty guideline), never above the Standard 10-Year amount. Forgiveness after 240 qualifying payments. Closed to anyone taking a new loan on/after 2026-07-01.",
    sourceUrl: SA_PLANS,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── IBR — older borrower (15%, 25-yr) ───────────────────────────
  {
    id: "ibr_old",
    displayName: "IBR — Income-Based Repayment (older borrower)",
    status: "legacy",
    family: "idr",
    eligibleLoanTypes: ["direct_subsidized", "direct_unsubsidized", "direct_plus_student", "direct_consolidation", "ffel_stafford", "ffel_plus", "ffel_consolidation"],
    borrowerEligibility: {
      requiresBorrowerType: "old",
      excludesFirstDisbursementOnOrAfter: "2026-07-01",
      parentPlusIneligible: true,
    },
    discretionary: { povertyMultiplier: 1.5 },
    idrPercent: 15,
    spouseIncome: { mfj: "combined", mfs: "filer_only" },
    cap: { kind: "standard_10" },
    minPayment: 0,
    rounding: "nearest_cent",
    forgivenessMonths: 300,
    pslfEligible: true,
    tooltip:
      "IBR for 'older' borrowers (had a federal loan balance as of 2014-07-01). 15% of discretionary income, capped at the Standard 10-Year amount. 25-year forgiveness.",
    description:
      "For borrowers with an outstanding Direct/FFEL balance on 2014-07-01. Payment = 15% × (AGI − 150% × poverty guideline), capped at Standard 10-Year. 300 qualifying payments to forgiveness.",
    sourceUrl: SA_PLANS,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── PAYE ─────────────────────────────────────────────────────────
  {
    id: "paye",
    displayName: "PAYE — Pay As You Earn",
    status: "legacy",
    family: "idr",
    eligibleLoanTypes: ["direct_subsidized", "direct_unsubsidized", "direct_plus_student", "direct_consolidation"],
    borrowerEligibility: {
      requiresFirstDisbursementOnOrBefore: "2026-06-30",
      excludesFirstDisbursementOnOrAfter: "2026-07-01",
      parentPlusIneligible: true,
    },
    discretionary: { povertyMultiplier: 1.5 },
    idrPercent: 10,
    spouseIncome: { mfj: "combined", mfs: "filer_only" },
    cap: { kind: "standard_10" },
    minPayment: 0,
    rounding: "nearest_cent",
    forgivenessMonths: 240,
    pslfEligible: true,
    tooltip:
      "10% of discretionary income (AGI − 150% × poverty). Capped at the Standard 10-Year amount. 20-year forgiveness. Legacy — slated for full elimination.",
    description:
      "Open only to existing borrowers who took no new loan on/after 2026-07-01. Payment = 10% × (AGI − 150% × poverty), capped at Standard 10-Year. Slated for full elimination under OBBBA at a future date.",
    sourceUrl: SA_PLANS,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── ICR ──────────────────────────────────────────────────────────
  {
    id: "icr",
    displayName: "ICR — Income-Contingent Repayment",
    status: "legacy",
    family: "idr",
    eligibleLoanTypes: ["direct_subsidized", "direct_unsubsidized", "direct_plus_student", "direct_consolidation"],
    borrowerEligibility: {
      excludesFirstDisbursementOnOrAfter: "2026-07-01",
    },
    discretionary: { povertyMultiplier: 1.0 },
    idrPercent: 20,
    spouseIncome: { mfj: "combined", mfs: "filer_only" },
    cap: { kind: "twelve_year_income_adjusted" },
    minPayment: 0,
    rounding: "nearest_cent",
    forgivenessMonths: 300,
    pslfEligible: true,
    tooltip:
      "The lesser of 20% of discretionary income (using 100% of poverty) OR a 12-year income-adjusted schedule. Legacy — being wound down; retained as a bridge for parent-PLUS-consolidation borrowers to reach IBR.",
    description:
      "Payment = min(20% × (AGI − 100% × poverty), 12-year income-adjusted amortization on outstanding balance). Only reachable path for Parent-PLUS-consolidation borrowers to eventually access IBR before ICR is eliminated under OBBBA.",
    sourceUrl: SA_PLANS,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "pending",
    verificationNotes: [
      "Discretionary multiplier of 100% verified against historical 34 CFR 685.209 but not re-confirmed against the May 2026 final rule text.",
      "Parent-PLUS-consolidation ICR-to-IBR bridge enrollment deadline has not yet been published by ED.",
    ],
  },

  // ─── SAVE — CLOSED ────────────────────────────────────────────────
  {
    id: "save",
    displayName: "SAVE — Saving on a Valuable Education",
    status: "closed",
    family: "idr",
    effectiveStart: "2023-08-16",
    effectiveEnd: "2026-03-27",
    eligibleLoanTypes: [],
    borrowerEligibility: {},
    cap: { kind: "none" },
    minPayment: 0,
    rounding: "nearest_cent",
    tooltip:
      "SAVE was terminated by federal court order in March 2026 and is no longer selectable. Enrolled borrowers are being transitioned to another plan.",
    description:
      "The 8th Circuit ruled SAVE unlawful in 2024; ED formally terminated the plan on 2026-03-27. This estimator will not produce SAVE payment estimates.",
    unavailableReason:
      "SAVE was terminated by court order on 2026-03-27. Estimate unavailable — please choose another plan.",
    sourceUrl: SAVE_TERMINATION,
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },

  // ─── REPAYE — HISTORICAL ──────────────────────────────────────────
  {
    id: "repaye",
    displayName: "REPAYE — Revised Pay As You Earn",
    status: "historical",
    family: "idr",
    effectiveStart: "2015-12-17",
    effectiveEnd: "2023-08-16",
    eligibleLoanTypes: [],
    borrowerEligibility: {},
    cap: { kind: "none" },
    minPayment: 0,
    rounding: "nearest_cent",
    tooltip:
      "REPAYE was renamed/replaced by the SAVE plan in 2023 and no longer exists as a standalone option.",
    description:
      "REPAYE was superseded by the new SAVE plan under the 2023 IDR final rule. It is not selectable.",
    unavailableReason:
      "REPAYE was replaced by SAVE in 2023. Estimate unavailable — please choose an active plan.",
    sourceUrl: "https://www.ed.gov/media/document/idrfrfactsheetpdf-58881.pdf",
    sourceUpdatedAt: "2026-07-06",
    rulesVersion: REGISTRY_VERSION,
    verification: "confirmed",
  },
];

export const PLAN_MAP: Record<string, PlanRule> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
);

export function getPlan(id: string): PlanRule | undefined {
  return PLAN_MAP[id];
}

export interface ListPlansOptions {
  status?: PlanRule["status"] | PlanRule["status"][];
  /** If provided, restrict to plans whose effective window contains this date. */
  asOf?: string;
  /** Include plans in these statuses; default excludes 'closed' and 'historical'. */
  includeUnselectable?: boolean;
}

export function listPlans(opts: ListPlansOptions = {}): PlanRule[] {
  const statuses = opts.status
    ? Array.isArray(opts.status) ? opts.status : [opts.status]
    : opts.includeUnselectable
      ? undefined
      : (["current", "legacy"] as PlanRule["status"][]);
  return PLANS.filter((p) => {
    if (statuses && !statuses.includes(p.status)) return false;
    if (opts.asOf) {
      if (p.effectiveStart && opts.asOf < p.effectiveStart) return false;
      if (p.effectiveEnd && opts.asOf > p.effectiveEnd) return false;
    }
    return true;
  });
}

export interface BorrowerEligibilityContext {
  firstDisbursementDate?: string | null;
  ibrBorrowerType?: "new_2014" | "old" | null;
  isParentPlus?: boolean | null;
  parentPlusConsolidated?: boolean | null;
  outstandingBalance?: number | null;
  hasNewLoanOnOrAfter_2026_07_01?: boolean | null;
}

export interface EligibilityCheck {
  ok: boolean;
  status: "confirmed" | "assumed" | "ineligible";
  reasons: string[];
}

export function assertPlanSelectable(
  plan: PlanRule,
  borrower: BorrowerEligibilityContext,
): EligibilityCheck {
  const reasons: string[] = [];
  if (plan.status === "closed" || plan.status === "historical") {
    return {
      ok: false,
      status: "ineligible",
      reasons: [plan.unavailableReason ?? `${plan.displayName} is not selectable (${plan.status}).`],
    };
  }
  const el = plan.borrowerEligibility;

  if (el.parentPlusIneligible) {
    if (borrower.isParentPlus === true) {
      reasons.push("Parent PLUS loans are not eligible for this plan.");
    } else if (borrower.parentPlusConsolidated === true) {
      reasons.push("Consolidations that repaid a Parent PLUS loan are not eligible for this plan.");
    }
  }
  if (el.minOutstandingBalance != null && borrower.outstandingBalance != null) {
    if (borrower.outstandingBalance <= el.minOutstandingBalance) {
      reasons.push(
        `Requires more than $${el.minOutstandingBalance.toLocaleString()} in outstanding balance.`,
      );
    }
  }
  if (el.excludesFirstDisbursementOnOrAfter && borrower.firstDisbursementDate) {
    if (borrower.firstDisbursementDate >= el.excludesFirstDisbursementOnOrAfter) {
      reasons.push(
        `Not available for loans first disbursed on/after ${el.excludesFirstDisbursementOnOrAfter}.`,
      );
    }
  }
  if (el.requiresFirstDisbursementOnOrBefore && borrower.firstDisbursementDate) {
    if (borrower.firstDisbursementDate > el.requiresFirstDisbursementOnOrBefore) {
      reasons.push(
        `Requires first disbursement on/before ${el.requiresFirstDisbursementOnOrBefore}.`,
      );
    }
  }
  if (
    el.excludesFirstDisbursementOnOrAfter &&
    borrower.hasNewLoanOnOrAfter_2026_07_01 === true
  ) {
    reasons.push(
      "Any new loan disbursed on/after 2026-07-01 disqualifies this legacy plan.",
    );
  }
  if (el.requiresBorrowerType && borrower.ibrBorrowerType) {
    if (borrower.ibrBorrowerType !== el.requiresBorrowerType) {
      reasons.push(
        `Requires ${el.requiresBorrowerType === "new_2014" ? "'new' borrower (no balance as of 2014-07-01)" : "'old' borrower (balance on 2014-07-01)"} status.`,
      );
    }
  }

  if (reasons.length > 0) {
    return { ok: false, status: "ineligible", reasons };
  }

  // If any critical eligibility signal is missing, mark as 'assumed'.
  const missing: string[] = [];
  if (el.parentPlusIneligible && borrower.isParentPlus == null && borrower.parentPlusConsolidated == null) {
    missing.push("Parent PLUS status not confirmed.");
  }
  if (el.requiresBorrowerType && !borrower.ibrBorrowerType) {
    missing.push("IBR borrower type (pre-/post-2014-07-01) not confirmed.");
  }
  if (el.excludesFirstDisbursementOnOrAfter && !borrower.firstDisbursementDate && borrower.hasNewLoanOnOrAfter_2026_07_01 == null) {
    missing.push("Loan first-disbursement date not confirmed.");
  }
  if (missing.length > 0) {
    return { ok: true, status: "assumed", reasons: missing };
  }
  return { ok: true, status: "confirmed", reasons: [] };
}
