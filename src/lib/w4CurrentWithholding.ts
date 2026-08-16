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
 * Build the employer-specific recommendation from the engine's incremental
 * per-paycheck ask and the employer's current W-4 extra amount.
 *
 * @param incrementalPerPaycheck additional per-paycheck need from the engine
 *        (already net of the current extra, because the current extra is
 *        counted as projected future withholding)
 * @param currentExtraPerPaycheck what's on the employer's W-4 today
 * @param surplusReductionPerPaycheck optional over-withholding reduction
 *        attributable to this employer (never more than the current extra)
 */
export function computeW4RecommendedChange(
  incrementalPerPaycheck: number,
  currentExtraPerPaycheck: unknown,
  surplusReductionPerPaycheck = 0,
  tolerance = W4_CHANGE_TOLERANCE,
): W4RecommendedChange {
  const current = resolveCurrentExtraW4(currentExtraPerPaycheck);
  const increment = Math.max(0, Number(incrementalPerPaycheck) || 0);
  const reduction = Math.min(
    current,
    Math.max(0, Number(surplusReductionPerPaycheck) || 0),
  );
  const recommended = Math.max(0, current + increment - reduction);
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
  /** Additional per-paycheck ask straight from the existing engine allocation. */
  incrementalPerPaycheck: number;
  change: W4RecommendedChange;
  /** Total recommended extra across remaining paychecks this year. */
  annualRecommendedExtra: number;
}

/**
 * Join the existing engine allocations with each employer's current W-4 extra
 * amount. Employer-specific throughout — one employer's setting never leaks
 * into another's recommendation.
 */
export function buildEmployerW4Recommendations<TRow extends EmployerW4Row>(
  rows: TRow[],
  allocations: Array<{ streamId: string; step4cPerPaycheck: number }>,
  annualSurplus = 0,
): Array<EmployerW4Recommendation<TRow>> {
  const surplusByKey = allocateW4SurplusReduction(
    rows.map((r) => ({
      key: r.streamId,
      currentExtraPerPaycheck: resolveCurrentExtraW4(r.currentExtraW4PerPaycheck),
      remainingPaychecks: r.remainingPaychecks,
    })),
    annualSurplus,
  );
  return rows.map((row) => {
    const incrementalPerPaycheck =
      allocations.find((a) => a.streamId === row.streamId)?.step4cPerPaycheck ?? 0;
    const change = computeW4RecommendedChange(
      incrementalPerPaycheck,
      row.currentExtraW4PerPaycheck,
      surplusByKey.get(row.streamId) ?? 0,
    );
    return {
      row,
      incrementalPerPaycheck,
      change,
      annualRecommendedExtra:
        change.recommendedExtraPerPaycheck * Math.max(0, row.remainingPaychecks),
    };
  });
}
