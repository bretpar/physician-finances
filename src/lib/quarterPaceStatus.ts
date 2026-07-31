/**
 * Quarter pace status — DISPLAY LOGIC ONLY.
 *
 * Single source of truth for "am I on track *today*?" messaging. Every
 * consumer (dashboard focus banner, Tax Progress / Quarterly Tracker card,
 * Financial Assistant, notification insights) must derive its tone and copy
 * from this helper so the app never shows contradictory statuses.
 *
 * The key rule: never compare savings to the FULL quarterly target. Compare
 * against the amount that should have been saved as of today (the quarter
 * target pro-rated by elapsed time in the quarter window).
 *
 * No tax math, no API calls, no writes — all inputs come from
 * `buildQuarterRecommendation`.
 */

export type QuarterPaceStatus =
  | "not_applicable"
  | "future"
  | "on_track"
  | "ahead"
  | "slightly_behind"
  | "behind"
  | "overdue";

export interface QuarterPaceInput {
  /** Full-quarter recommended set-aside (quarterTarget). */
  quarterTarget: number;
  /** Paid + saved so far this quarter (progressAmount). */
  progressAmount: number;
  /** Quarter window start (inclusive). */
  start: Date;
  /** Quarter window end (exclusive). */
  end: Date;
  /** Days until the estimated payment deadline (negative = passed). */
  daysUntilDue?: number;
  /** Short label, e.g. "Q3". */
  quarterLabel?: string;
  /** Deadline display label, e.g. "Sep 15". */
  deadlineLabel?: string;
  /** False for W-2-only users with no estimated payments. */
  showQuarterly?: boolean;
  now?: Date;
}

export interface QuarterPaceResult {
  status: QuarterPaceStatus;
  /** "success" (green) | "info" (yellow) | "warning" (red) | "neutral". */
  tone: "success" | "info" | "warning" | "neutral";
  /** Fraction of the quarter window elapsed, 0-1. */
  elapsedFraction: number;
  /** Dollars that should have been set aside by today. */
  recommendedToDate: number;
  /** Dollars actually paid + saved this quarter. */
  savedToDate: number;
  /** savedToDate / recommendedToDate (1 when nothing is expected yet). */
  paceRatio: number;
  /** max(0, recommendedToDate - savedToDate). */
  shortfallToDate: number;
  headline: string;
  detail: string;
  /** True when the status warrants an actionable nudge. */
  needsAction: boolean;
}

/** At or above this share of TODAY's recommendation the user is on track. */
export const PACE_ON_TRACK = 0.95;
/** Between this and PACE_ON_TRACK the user is only "slightly behind". */
export const PACE_SLIGHTLY_BEHIND = 0.8;
/** Comfortably above pace. */
export const PACE_AHEAD = 1.05;

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

const noon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);

export function computeQuarterPace(input: QuarterPaceInput): QuarterPaceResult {
  const target = Math.max(0, num(input.quarterTarget));
  const saved = Math.max(0, num(input.progressAmount));
  const daysUntilDue = num(input.daysUntilDue);
  const label = input.quarterLabel || "this quarter";
  const deadlineLabel = input.deadlineLabel || "";
  const now = noon(input.now ?? new Date());
  const start = noon(input.start);
  const end = noon(input.end);

  const totalMs = Math.max(1, end.getTime() - start.getTime());
  const elapsedFraction = Math.max(0, Math.min(1, (now.getTime() - start.getTime()) / totalMs));
  const recommendedToDate = target * elapsedFraction;
  const shortfallToDate = Math.max(0, recommendedToDate - saved);
  const paceRatio = recommendedToDate > 0 ? saved / recommendedToDate : 1;

  const base = {
    elapsedFraction,
    recommendedToDate,
    savedToDate: saved,
    paceRatio,
    shortfallToDate,
  };

  if (input.showQuarterly === false || target <= 0) {
    return {
      ...base,
      status: "not_applicable",
      tone: "neutral",
      headline: "No estimated tax target this quarter.",
      detail: "",
      needsAction: false,
    };
  }

  if (now < start) {
    return {
      ...base,
      status: "future",
      tone: "neutral",
      headline: `${label} hasn't started yet — nothing due today.`,
      detail: "",
      needsAction: false,
    };
  }

  const missedDeadline = daysUntilDue < 0 && paceRatio < PACE_ON_TRACK;

  if (missedDeadline) {
    return {
      ...base,
      status: "overdue",
      tone: "warning",
      headline: `Your ${label} estimated payment deadline has passed.`,
      detail: "Review your tax savings plan.",
      needsAction: true,
    };
  }

  if (paceRatio < PACE_SLIGHTLY_BEHIND) {
    return {
      ...base,
      status: "behind",
      tone: "warning",
      headline: "You're significantly behind your recommended quarterly tax savings.",
      detail: "Review your tax savings plan.",
      needsAction: true,
    };
  }

  if (paceRatio < PACE_ON_TRACK) {
    return {
      ...base,
      status: "slightly_behind",
      tone: "info",
      headline: "You're slightly behind today's recommended savings.",
      detail: `Saving another ${usd(shortfallToDate)} would bring you back on track.`,
      needsAction: false,
    };
  }

  if (paceRatio > PACE_AHEAD) {
    return {
      ...base,
      status: "ahead",
      tone: "success",
      headline: "You're ahead on your quarterly tax savings.",
      detail: `${usd(saved)} saved of today's recommended ${usd(recommendedToDate)}.`,
      needsAction: false,
    };
  }

  return {
    ...base,
    status: "on_track",
    tone: "success",
    headline: "You're on track with your quarterly tax savings.",
    detail: deadlineLabel
      ? `${usd(saved)} saved of today's recommended ${usd(recommendedToDate)} · next deadline ${deadlineLabel}.`
      : `${usd(saved)} saved of today's recommended ${usd(recommendedToDate)}.`,
    needsAction: false,
  };
}
