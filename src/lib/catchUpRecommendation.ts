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

/**
 * Derive the quarter target the user was effectively recommended against,
 * WITHOUT any new schema. Prior recommendations are snapshotted per income row
 * (`dynamic_tax_recommendation`); when every in-quarter row that carried a
 * recommendation was satisfied, the dollars covered so far represent a plan the
 * user fully followed — so that becomes the baseline. A later target increase is
 * then reported as "estimate increased" instead of blaming the user.
 *
 * Returns 0 when there is nothing to judge, or when any recommendation was left
 * unsatisfied (genuine noncompliance still shows as behind).
 */
export function deriveBaselineQuarterTarget(
  rows: Array<{ id?: string | null; recommended?: number | null; satisfied?: number | null }>,
  coveredSoFar: number,
  /**
   * Rows whose recommendation was generated BY the very event that raised the
   * target (e.g. the 1099 entry the user just added). They must never count as
   * "missed" history — the user hasn't had a chance to act on them yet.
   */
  excludeRowIds?: Iterable<string>,
): number {
  const excluded = new Set<string>(excludeRowIds ? Array.from(excludeRowIds) : []);
  let sawRecommendation = false;
  for (const r of rows) {
    if (r?.id && excluded.has(r.id)) continue;
    const recommended = Math.max(0, num(r?.recommended));
    if (recommended <= 0) continue;
    sawRecommendation = true;
    if (Math.max(0, num(r?.satisfied)) < recommended * COVERAGE_ON_TRACK) return 0;
  }
  return sawRecommendation ? Math.max(0, num(coveredSoFar)) : 0;
}

/**
 * Count remaining savings opportunities (future income events) between `now`

 * (exclusive) and the deadline (inclusive). Always at least 1 so a shortfall is
 * never silently dropped.
 */
export function countRemainingOpportunities(
  events: Array<{ date?: string | null }> | undefined,
  now: Date,
  deadline: Date,
): number {
  if (!events || events.length === 0) return 1;
  let count = 0;
  for (const e of events) {
    if (!e?.date) continue;
    const d = new Date(e.date);
    if (Number.isNaN(d.getTime())) continue;
    if (d > now && d <= deadline) count += 1;
  }
  return Math.max(1, count);
}
