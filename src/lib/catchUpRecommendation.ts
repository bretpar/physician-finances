/**
 * Catch-up recommendation helper — PURE MATH + STATUS LANGUAGE.
 * --------------------------------------------------------------------------
 * Fixes the "save 100% of every recommendation and still be labeled behind"
 * class of bug by giving the app ONE way to answer:
 *
 *   1. How far off target am I for this quarter right now?
 *   2. How much extra should each REMAINING savings opportunity carry so the
 *      shortfall is closed by the deadline?
 *   3. Is the gap because the user ignored recommendations, or because the
 *      tax estimate itself increased mid-quarter?
 *
 * Design rules:
 *   - Prospective only. Prior recommendations are never rewritten. The whole
 *     shortfall is spread across FUTURE opportunities.
 *   - Nothing here touches tax math, quarter targets or the tax engine. All
 *     inputs come from `buildQuarterRecommendation`.
 *   - Status language distinguishes "you followed the plan, the estimate moved"
 *     from "you are genuinely behind".
 */

export type CoverageStatus =
  | "not_applicable"
  | "ahead"
  | "on_track"
  | "estimate_increased"
  | "catch_up_needed";

/** Legacy 3-value status persisted on income rows (`recommendation_status`). */
export type LegacyRecommendationStatus = "ahead" | "on_track" | "behind";

export interface CatchUpInput {
  /** Full-quarter target (quarterTarget from buildQuarterRecommendation). */
  quarterTarget: number;
  /** Paid + Saved so far this quarter (progressAmount). */
  coveredSoFar: number;
  /**
   * Number of remaining expected savings opportunities (paychecks / income
   * events) before the deadline. Defaults to 1 so the shortfall is never
   * silently dropped.
   */
  remainingOpportunities?: number;
  /**
   * The quarter target the user was previously recommended against, when
   * known. Used only to distinguish "estimate increased" from "behind" — it
   * never changes any dollar amount.
   */
  baselineQuarterTarget?: number;
}

export interface CatchUpResult {
  /** Signed gap: positive = shortfall, negative = surplus. */
  shortfallOrSurplus: number;
  /** max(0, shortfallOrSurplus) — dollars still needed by the deadline. */
  totalShortfallByDeadline: number;
  /** Opportunities the shortfall was spread across (>= 1). */
  remainingOpportunities: number;
  /** Per-opportunity catch-up dollars to add on top of the normal amount. */
  quarterlyAdjustmentAmount: number;
  recommendationStatus: CoverageStatus;
  /** 3-value status safe to persist in `recommendation_status`. */
  legacyStatus: LegacyRecommendationStatus;
  /** Short status label for badges/headlines. */
  statusHeadline: string;
  /** Tooltip-length explanation. Never blames the user for a moved target. */
  statusDetail: string;
}

/** Covered at or above this share of the target counts as on track. */
export const COVERAGE_ON_TRACK = 0.95;
/** Comfortably above target. */
export const COVERAGE_AHEAD = 1.05;

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

export function computeCatchUpRecommendation(input: CatchUpInput): CatchUpResult {
  const target = Math.max(0, num(input.quarterTarget));
  const covered = Math.max(0, num(input.coveredSoFar));
  const opportunities = Math.max(1, Math.floor(num(input.remainingOpportunities) || 1));
  const baseline = Math.max(0, num(input.baselineQuarterTarget));

  const shortfallOrSurplus = round2(target - covered);
  const totalShortfallByDeadline = Math.max(0, shortfallOrSurplus);
  const quarterlyAdjustmentAmount = round2(totalShortfallByDeadline / opportunities);

  const base = {
    shortfallOrSurplus,
    totalShortfallByDeadline,
    remainingOpportunities: opportunities,
    quarterlyAdjustmentAmount,
  };

  if (target <= 0) {
    return {
      ...base,
      quarterlyAdjustmentAmount: 0,
      recommendationStatus: "not_applicable",
      legacyStatus: "on_track",
      statusHeadline: "No estimated tax target this quarter",
      statusDetail: "",
    };
  }

  const ratio = covered / target;

  if (ratio >= COVERAGE_AHEAD) {
    return {
      ...base,
      recommendationStatus: "ahead",
      legacyStatus: "ahead",
      statusHeadline: "Ahead of plan",
      statusDetail: `You've set aside ${usd(covered)} against a ${usd(target)} target for this quarter.`,
    };
  }

  if (ratio >= COVERAGE_ON_TRACK) {
    return {
      ...base,
      recommendationStatus: "on_track",
      legacyStatus: "on_track",
      statusHeadline: "On plan",
      statusDetail: `You've covered ${usd(covered)} of your ${usd(target)} target for this quarter.`,
    };
  }

  // The user followed the plan, but the target moved up mid-quarter. Never
  // imply they made a mistake — absorb the difference going forward.
  const estimateIncreased =
    baseline > 0 && target > baseline && covered >= baseline * COVERAGE_ON_TRACK;

  if (estimateIncreased) {
    return {
      ...base,
      recommendationStatus: "estimate_increased",
      legacyStatus: "on_track",
      statusHeadline: "On plan — estimate increased",
      statusDetail:
        `Your tax estimate increased from ${usd(baseline)} to ${usd(target)} for this quarter. ` +
        `Earlier recommendations were correct at the time. Save an additional ` +
        `${usd(totalShortfallByDeadline)} across your remaining ${opportunities} ` +
        `${opportunities === 1 ? "paycheck" : "paychecks"} ` +
        `(about ${usd(quarterlyAdjustmentAmount)} each) to stay on target.`,
    };
  }

  return {
    ...base,
    recommendationStatus: "catch_up_needed",
    legacyStatus: "behind",
    statusHeadline: "Additional catch-up needed",
    statusDetail:
      `You're ${usd(totalShortfallByDeadline)} short of this quarter's ${usd(target)} target. ` +
      `Adding about ${usd(quarterlyAdjustmentAmount)} to each of your remaining ${opportunities} ` +
      `${opportunities === 1 ? "paycheck" : "paychecks"} closes the gap by the deadline.`,
  };
}
