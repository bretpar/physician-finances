/**
 * w4CurrentWithholding
 *
 * Small pure helpers that turn the EXISTING per-employer W-4 engine output
 * (the additional extra withholding still needed per paycheck) plus the
 * employer-specific "current extra W-4 withholding" the user already has on
 * file into a user-facing "increase / decrease / no change" recommendation.
 *
 * Design notes:
 * - The current extra amount is FUTURE expected withholding. Callers fold it
 *   into projected future W-2 withholding only; historical paychecks keep
 *   their actual recorded withholding.
 * - Because the engine gap already nets out the current extra, the engine's
 *   per-paycheck allocation IS the incremental change. The recommended TOTAL
 *   Step 4(c) amount is therefore `current + incremental`.
 */

/** Per-paycheck tolerance — below this we don't ask users to touch their W-4. */
export const W4_CHANGE_TOLERANCE = 5;

/** Coerce a persisted / user-typed current extra W-4 value to a safe number. */
export function resolveCurrentExtraW4(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

export type W4ChangeDirection = "increase" | "decrease" | "none";

export interface W4RecommendedChange {
  /** What the user currently has entered in Step 4(c) for this employer. */
  currentExtraPerPaycheck: number;
  /** Full recommended Step 4(c) amount for this employer. */
  recommendedExtraPerPaycheck: number;
  /** Signed difference (recommended − current). */
  deltaPerPaycheck: number;
  /** Absolute change to show the user. */
  changeAmountPerPaycheck: number;
  direction: W4ChangeDirection;
  /** Short user-facing sentence. */
  label: string;
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.round(n),
  );

/**
 * Build the employer-specific recommendation from the employer's TARGET extra
 * per paycheck (sized from the stable annual W-2 gap, independent of what the
 * user currently has on file) and the employer's current W-4 extra amount.
 *
 * @param targetPerPaycheck full recommended Step 4(c) amount for this employer
 * @param currentExtraPerPaycheck what's on the employer's W-4 today
 */
export function computeW4RecommendedChange(
  targetPerPaycheck: number,
  currentExtraPerPaycheck: unknown,
  tolerance = W4_CHANGE_TOLERANCE,
): W4RecommendedChange {
  const current = resolveCurrentExtraW4(currentExtraPerPaycheck);
  const recommended = Math.max(0, Number(targetPerPaycheck) || 0);
  const delta = Math.round((recommended - current) * 100) / 100;
  const abs = Math.abs(delta);

  if (abs < tolerance) {
    return {
      currentExtraPerPaycheck: current,
      recommendedExtraPerPaycheck: recommended,
      deltaPerPaycheck: delta,
      changeAmountPerPaycheck: abs,
      direction: "none",
      label: "No change recommended",
    };
  }

  const direction: W4ChangeDirection = delta > 0 ? "increase" : "decrease";
  return {
    currentExtraPerPaycheck: current,
    recommendedExtraPerPaycheck: recommended,
    deltaPerPaycheck: delta,
    changeAmountPerPaycheck: abs,
    direction,
    label: `${direction === "increase" ? "Increase" : "Decrease"} by ${fmtUsd(abs)}/paycheck`,
  };
}


export interface SurplusRowInput {
  key: string;
  currentExtraPerPaycheck: number;
  remainingPaychecks: number;
}

/**
 * When the W-2 source is OVER-withheld, spread the annual surplus across the
 * employers that actually have extra W-4 withholding on file, proportional to
 * the dollars they contribute, capped at each employer's current extra.
 * Returns per-paycheck reductions keyed by row key.
 */
export function allocateW4SurplusReduction(
  rows: SurplusRowInput[],
  annualSurplus: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const surplus = Math.max(0, Number(annualSurplus) || 0);
  if (surplus <= 0) return out;
  const eligible = rows.filter(
    (r) => resolveCurrentExtraW4(r.currentExtraPerPaycheck) > 0 && r.remainingPaychecks > 0,
  );
  const totalExtraDollars = eligible.reduce(
    (s, r) => s + resolveCurrentExtraW4(r.currentExtraPerPaycheck) * r.remainingPaychecks,
    0,
  );
  if (totalExtraDollars <= 0) return out;
  for (const r of eligible) {
    const current = resolveCurrentExtraW4(r.currentExtraPerPaycheck);
    const share = (current * r.remainingPaychecks) / totalExtraDollars;
    const annualReduction = Math.min(surplus * share, current * r.remainingPaychecks);
    out.set(r.key, annualReduction / r.remainingPaychecks);
  }
  return out;
}

/**
 * Convert INCREMENTAL allocations (allocated from the gap that remains AFTER
 * crediting every employer's current Step 4(c)) into absolute per-employer
 * targets: `target = current extra + incremental − surplus reduction`.
 *
 * Weighting happens upstream on the incremental gap only, so one employer's
 * current Step 4(c) can never re-weight another employer's target.
 */
export function stabilizeW4Targets<
  TRow extends { streamId: string; remainingPaychecks: number; currentExtraW4PerPaycheck?: number },
>(
  rows: TRow[],
  incrementalAllocations: Array<{ streamId: string; step4cPerPaycheck: number }>,
  surplusReductions: Map<string, number> = new Map(),
): Array<{ streamId: string; step4cPerPaycheck: number }> {
  return rows.map((row) => {
    const incremental =
      incrementalAllocations.find((a) => a.streamId === row.streamId)?.step4cPerPaycheck ?? 0;
    const current = resolveCurrentExtraW4(row.currentExtraW4PerPaycheck);
    const reduction = Math.max(0, Number(surplusReductions.get(row.streamId)) || 0);
    const hasPaychecks = Math.max(0, Number(row.remainingPaychecks) || 0) > 0;
    const target = hasPaychecks ? current + incremental - reduction : 0;
    return { streamId: row.streamId, step4cPerPaycheck: Math.max(0, Math.round(target)) };
  });
}

export interface EmployerW4Row {
  /** Row key (employer key) used to match the allocation entry. */
  streamId: string;
  company: string;
  remainingPaychecks: number;
  /** Employer-specific current extra W-4 amount per paycheck. */
  currentExtraW4PerPaycheck?: number;
  /** Company record id, when the row is backed by a saved employer. */
  companyId?: string | null;
}

export interface EmployerW4Recommendation<TRow extends EmployerW4Row = EmployerW4Row> {
  row: TRow;
  /** Target per-paycheck extra for this employer, from the engine allocation. */
  incrementalPerPaycheck: number;
  change: W4RecommendedChange;
  /** Total recommended extra across remaining paychecks this year. */
  annualRecommendedExtra: number;
}

/**
 * Join the engine allocations (stable per-employer TARGETS) with each
 * employer's current W-4 extra amount. Employer-specific throughout — one
 * employer's setting never leaks into another's recommendation, and changing it
 * never re-weights the shared target.
 */
export function buildEmployerW4Recommendations<TRow extends EmployerW4Row>(
  rows: TRow[],
  allocations: Array<{ streamId: string; step4cPerPaycheck: number }>,
): Array<EmployerW4Recommendation<TRow>> {
  return rows.map((row) => {
    const targetPerPaycheck =
      allocations.find((a) => a.streamId === row.streamId)?.step4cPerPaycheck ?? 0;
    const change = computeW4RecommendedChange(
      targetPerPaycheck,
      row.currentExtraW4PerPaycheck,
    );
    return {
      row,
      incrementalPerPaycheck: targetPerPaycheck,
      change,
      annualRecommendedExtra:
        change.recommendedExtraPerPaycheck * Math.max(0, row.remainingPaychecks),
    };
  });
}

