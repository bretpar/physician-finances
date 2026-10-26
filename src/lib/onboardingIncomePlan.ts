/**
 * onboardingIncomePlan
 *
 * Turns the simplified onboarding answers (expected annual income + optional
 * year-to-date amount) into ONE Income Planner stream for the rest of the tax
 * year. Pure / framework-free so it can be unit-tested.
 *
 * Rules:
 *  - Monthly allocation = annual / 12 (or annual / periods for the pay schedule).
 *  - The stream starts today, so earlier months are never planned occurrences
 *    and are never turned into ledger rows, paychecks or withholding.
 *  - Without YTD, earlier-in-year income is an *estimate* =
 *    annual − (planned remaining). With YTD, remaining = annual − YTD spread
 *    over the remaining occurrences.
 *  - Withholding is left at $0/unknown — never invented.
 */
import { addMonths, addWeeks, addDays, parseISO, format, isAfter } from "date-fns";

export type PlannerFrequency = "weekly" | "biweekly" | "monthly" | "custom";

export interface OnboardingPlanInput {
  annual: number;
  /** User-entered YTD amount; null/undefined = skipped. */
  ytd?: number | null;
  /** Company pay frequency (W-2) — null for business sources. */
  payFrequency?: string | null;
  /** yyyy-MM-dd local "today". */
  today: string;
}

export interface OnboardingPlan {
  plannerFrequency: PlannerFrequency;
  customIntervalDays: number | null;
  startDate: string;
  endDate: string;
  occurrences: number;
  perOccurrence: number;
  plannedRemaining: number;
  /** Income before the plan starts: user YTD or an estimate. Never recorded. */
  earlierInYear: number;
  earlierInYearSource: "user_ytd" | "estimated";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Map a company pay frequency onto a Planner schedule. Variable → monthly. */
export function plannerScheduleFor(payFrequency?: string | null): {
  frequency: PlannerFrequency;
  customDays: number | null;
  periodsPerYear: number;
} {
  switch (payFrequency) {
    case "weekly": return { frequency: "weekly", customDays: null, periodsPerYear: 52 };
    case "biweekly": return { frequency: "biweekly", customDays: null, periodsPerYear: 26 };
    // Planner has no native semimonthly schedule; 15-day custom interval ≈ 24/yr.
    case "semimonthly": return { frequency: "custom", customDays: 15, periodsPerYear: 24 };
    default: return { frequency: "monthly", customDays: null, periodsPerYear: 12 };
  }
}

function nextDate(d: Date, f: PlannerFrequency, customDays: number | null): Date {
  if (f === "weekly") return addWeeks(d, 1);
  if (f === "biweekly") return addWeeks(d, 2);
  if (f === "custom") return addDays(d, customDays || 15);
  return addMonths(d, 1);
}

export function countOccurrences(start: string, end: string, f: PlannerFrequency, customDays: number | null): number {
  const endD = parseISO(end);
  let d = parseISO(start);
  let n = 0;
  while (!isAfter(d, endD) && n < 400) {
    n++;
    d = nextDate(d, f, customDays);
  }
  return n;
}

export function buildOnboardingIncomePlan(input: OnboardingPlanInput): OnboardingPlan | null {
  const annual = Number(input.annual) || 0;
  if (annual <= 0) return null;
  const year = input.today.slice(0, 4);
  const endDate = `${year}-12-31`;
  const { frequency, customDays, periodsPerYear } = plannerScheduleFor(input.payFrequency);
  const occurrences = countOccurrences(input.today, endDate, frequency, customDays);
  const ytd = input.ytd != null && Number.isFinite(Number(input.ytd)) && Number(input.ytd) >= 0 ? Number(input.ytd) : null;

  let perOccurrence: number;
  if (ytd != null) {
    const remaining = Math.max(0, annual - ytd);
    perOccurrence = occurrences > 0 ? round2(remaining / occurrences) : 0;
  } else {
    perOccurrence = round2(annual / periodsPerYear);
  }
  const plannedRemaining = round2(perOccurrence * occurrences);
  const earlierInYear = ytd != null ? round2(ytd) : round2(Math.max(0, annual - plannedRemaining));
  return {
    plannerFrequency: frequency,
    customIntervalDays: customDays,
    startDate: input.today,
    endDate,
    occurrences,
    perOccurrence,
    plannedRemaining,
    earlierInYear,
    earlierInYearSource: ytd != null ? "user_ytd" : "estimated",
  };
}

/** Metadata saved on the company (advanced_field_visibility) — no new columns. */
export const ONBOARDING_PLAN_KEY = "onboarding_income_plan";
export interface OnboardingPlanMeta {
  taxYear: number;
  annual: number;
  ytdEntered: number | null;
  originalPlan?: { streamId: string; startDate: string; historicalGross: number };
}

export function readOnboardingPlanMeta(visibility: unknown): OnboardingPlanMeta | null {
  const raw = (visibility as Record<string, unknown> | null | undefined)?.[ONBOARDING_PLAN_KEY] as any;
  if (!raw || typeof raw !== "object") return null;
  const annual = Number(raw.annual);
  if (!(annual > 0)) return null;
  return {
    taxYear: Number(raw.taxYear) || 0,
    annual,
    ytdEntered: raw.ytdEntered == null ? null : Number(raw.ytdEntered),
    originalPlan: raw.originalPlan,
  };
}

/**
 * Planner summary for an onboarding-estimated source. Never adds estimate and
 * recorded income together: earlier-in-year = max(0, annual − recorded −
 * planned), so recorded actuals replace the estimate instead of stacking.
 */
export function summarizeOnboardingEstimate(args: { annual: number; recorded: number; planned: number }) {
  const annual = Math.max(0, args.annual);
  const recorded = Math.max(0, args.recorded);
  const planned = Math.max(0, args.planned);
  const earlierEstimate = round2(Math.max(0, annual - recorded - planned));
  return { annual, recorded: round2(recorded), planned: round2(planned), earlierEstimate, total: round2(earlierEstimate + recorded + planned) };
}

export function todayLocal(): string {
  return format(new Date(), "yyyy-MM-dd");
}
