/**
 * Single-source recommendation selector for the Dashboard Financial Assistant card.
 *
 * DISPLAY LOGIC ONLY — no tax math, no API calls, no writes. Every input comes
 * from calculations that already exist (canonical tax engine, quarter
 * recommendation, tax-savings hooks).
 *
 * Contract:
 *  - Exactly ONE recommendation is ever returned.
 *  - Candidates are evaluated against a fixed priority ladder, so two insights
 *    can never conflict (e.g. we never nudge deductions while the quarterly
 *    payment is short, and never nudge anything before income exists).
 *  - When the underlying data is still loading we return a neutral placeholder
 *    instead of a guess that would flip once data arrives.
 */

export type FinancialAssistantRecommendationId =
  | "loading"
  | "add-income"
  | "quarterly-overdue"
  | "quarterly-due-soon"
  | "quarterly-shortfall"
  | "quarterly-slightly-behind"
  | "quarterly-on-track"
  | "retirement"
  | "hsa"
  | "home-office"
  | "mileage"
  | "all-set";

export interface FinancialAssistantRecommendation {
  id: FinancialAssistantRecommendationId;
  /** Lower number = higher priority. Exposed for tests/debugging. */
  priority: number;
  text: string;
  cta: string;
  to: string;
}

export interface FinancialAssistantRecommendationInput {
  /** False while any dependency query is still loading. */
  isReady: boolean;
  projectedAnnualIncome: number;
  annualTaxLiability: number;
  /**
   * Pace ratio (0-1+) from `computeQuarterPace`: saved-to-date divided by the
   * amount recommended AS OF TODAY. Never the full-quarter coverage ratio.
   */
  savingsCoverageRatio: number;
  quarterLabel: string;
  deadlineLabel: string;
  daysUntilDue: number;
  showQuarterly: boolean;
  hasRetirement: boolean;
  hasHsa: boolean;
  hasHomeOffice: boolean;
  hasMileage: boolean;
}

/** At/above this share of TODAY's recommended set-aside the user is on track. */
export const QUARTERLY_COVERAGE_TARGET = 0.95;
/** Between this and the on-track threshold the user is only slightly behind. */
export const QUARTERLY_SLIGHTLY_BEHIND_TARGET = 0.8;
/** Within this many days a shortfall is treated as urgent. */
export const QUARTERLY_URGENT_DAYS = 14;

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/**
 * Ordered ladder. The first matching rule wins; there is no scoring ambiguity
 * and no way for two recommendations to render at once.
 */
export function selectFinancialAssistantRecommendation(
  input: FinancialAssistantRecommendationInput
): FinancialAssistantRecommendation {
  const income = num(input.projectedAnnualIncome);
  const tax = num(input.annualTaxLiability);
  const coverage = Math.max(0, num(input.savingsCoverageRatio));
  const daysUntilDue = num(input.daysUntilDue);
  const quarterLabel = input.quarterLabel || "this quarter";

  // 0. Data not settled yet — never guess, it would flip on load.
  if (!input.isReady) {
    return {
      id: "loading",
      priority: 0,
      text: "Pulling together your latest numbers…",
      cta: "Review Income Planner",
      to: "/projected-income",
    };
  }

  // 1. Nothing downstream is meaningful without projected income.
  if (income <= 0) {
    return {
      id: "add-income",
      priority: 1,
      text: "Add your expected paychecks so we can project your year.",
      cta: "Review Income Planner",
      to: "/projected-income",
    };
  }

  const quarterlyRelevant = input.showQuarterly && tax > 0;
  const onTrack = coverage >= QUARTERLY_COVERAGE_TARGET;
  const significantlyBehind = quarterlyRelevant && coverage < QUARTERLY_SLIGHTLY_BEHIND_TARGET;
  const slightlyBehind = quarterlyRelevant && !onTrack && !significantlyBehind;

  // 2-4. A missed deadline or a real shortfall against TODAY's recommended
  // savings always outranks a long-term savings idea. Users who are simply
  // mid-quarter and pacing normally never see a warning here.
  if (quarterlyRelevant && !onTrack && daysUntilDue < 0) {
    return {
      id: "quarterly-overdue",
      priority: 2,
      text: `Your ${quarterLabel} estimated payment deadline has passed. Review your tax savings plan.`,
      cta: "Review Quarterly Taxes",
      to: "/taxes",
    };
  }
  if (significantlyBehind) {
    if (daysUntilDue <= QUARTERLY_URGENT_DAYS) {
      const when = input.deadlineLabel ? ` It's due ${input.deadlineLabel}.` : "";
      return {
        id: "quarterly-due-soon",
        priority: 3,
        text: `You're significantly behind your recommended ${quarterLabel} tax savings.${when}`,
        cta: "Review Quarterly Taxes",
        to: "/taxes",
      };
    }
    return {
      id: "quarterly-shortfall",
      priority: 4,
      text: `You're significantly behind your recommended ${quarterLabel} tax savings.`,
      cta: "Review Quarterly Taxes",
      to: "/taxes",
    };
  }
  if (slightlyBehind) {
    return {
      id: "quarterly-slightly-behind",
      priority: 5,
      text: "You're slightly behind today's recommended savings.",
      cta: "Review Quarterly Taxes",
      to: "/taxes",
    };
  }

  // 6-9. Tax-savings gaps, in the same order as the Tax Savings page.
  if (!input.hasRetirement) {
    return {
      id: "retirement",
      priority: 6,
      text: "Your biggest opportunity is increasing your retirement contributions.",
      cta: "Review Tax Savings",
      to: "/deductions",
    };
  }
  if (!input.hasHsa) {
    return {
      id: "hsa",
      priority: 7,
      text: "Your biggest opportunity is funding an HSA with pre-tax dollars.",
      cta: "Review Tax Savings",
      to: "/deductions",
    };
  }
  if (!input.hasHomeOffice) {
    return {
      id: "home-office",
      priority: 8,
      text: "Your biggest opportunity is claiming a home office deduction.",
      cta: "Review Tax Savings",
      to: "/deductions",
    };
  }
  if (!input.hasMileage) {
    return {
      id: "mileage",
      priority: 9,
      text: "Your biggest opportunity is logging your business mileage this year.",
      cta: "Review Tax Savings",
      to: "/deductions",
    };
  }

  return {
    id: "all-set",
    priority: 10,
    text: "Everything looks good. You're on track with your projected income and tax savings.",
    cta: "View Dashboard",
    to: "/",
  };
}
