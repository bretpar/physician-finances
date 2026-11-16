/**
 * W-2 employer match / profit-sharing formulas for the retirement planner.
 * Stored per company in `companies.advanced_field_visibility.employer_contribution_formula`
 * (metadata only; never changes income, expense or tax records).
 *
 * The recorded formula produces an ESTIMATE of the employer contribution for
 * the year, which the retirement engine counts toward the plan's used room so
 * the remaining employer capacity reflects what the employer is expected to
 * add. Actual recorded employer contributions are never altered.
 *
 * Formula kinds (all rates are fractions: 0.5 = 50%, 0.06 = 6% of pay):
 *  - match:  employer matches `matchRate` of the employee's deferrals, but
 *            only on deferrals up to `matchCapPct` of pay.
 *  - tiered: e.g. 100% of the first 3% of pay deferred, then 50% of the next
 *            2%. Tiers are applied in ascending `upToPct` order.
 *  - flat:   a fixed dollar amount per year (e.g. $2,000 profit sharing).
 */
export const EMPLOYER_FORMULA_KEY = "employer_contribution_formula";

export interface MatchTier {
  /** Upper bound of this tier as a fraction of pay (e.g. 0.03 = first 3%). */
  upToPct: number;
  /** Match rate within this tier (e.g. 1 = 100%, 0.5 = 50%). */
  rate: number;
}

export type EmployerContributionFormula =
  | { kind: "match"; matchRate: number; matchCapPct: number }
  | { kind: "tiered"; tiers: MatchTier[] }
  | { kind: "flat"; annualAmount: number };

const frac = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function readEmployerContributionFormula(meta: unknown): EmployerContributionFormula | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>)[EMPLOYER_FORMULA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (r.kind === "match") {
    const matchRate = frac(r.matchRate);
    const matchCapPct = frac(r.matchCapPct);
    return matchRate != null && matchCapPct != null ? { kind: "match", matchRate, matchCapPct } : null;
  }
  if (r.kind === "tiered" && Array.isArray(r.tiers)) {
    const tiers: MatchTier[] = [];
    for (const t of r.tiers) {
      if (!t || typeof t !== "object") return null;
      const upToPct = frac((t as Record<string, unknown>).upToPct);
      const rate = frac((t as Record<string, unknown>).rate);
      if (upToPct == null || rate == null) return null;
      tiers.push({ upToPct, rate });
    }
    return tiers.length ? { kind: "tiered", tiers } : null;
  }
  if (r.kind === "flat") {
    const annualAmount = frac(r.annualAmount);
    return annualAmount != null ? { kind: "flat", annualAmount } : null;
  }
  return null;
}

export function writeEmployerContributionFormula<T extends object>(
  meta: T | null | undefined,
  formula: EmployerContributionFormula | null,
): T {
  const next = { ...((meta ?? {}) as Record<string, unknown>) };
  if (formula) next[EMPLOYER_FORMULA_KEY] = formula;
  else delete next[EMPLOYER_FORMULA_KEY];
  return next as T;
}

/**
 * Estimated employer contribution for the year from a recorded formula.
 *
 * @param compensation   eligible W-2 wages for the year (actual or projected)
 * @param employeeDeferral employee elective deferrals for the year
 * @returns estimated employer dollars; 0 when the formula can't produce one
 *          (e.g. match formula with unknown compensation)
 */
export function estimateEmployerContribution(
  formula: EmployerContributionFormula | null | undefined,
  compensation: number | null | undefined,
  employeeDeferral: number | null | undefined,
): number {
  if (!formula) return 0;
  const deferral = Math.max(0, Number(employeeDeferral) || 0);

  if (formula.kind === "flat") return formula.annualAmount;

  const comp = Number(compensation);
  if (!Number.isFinite(comp) || comp <= 0) return 0;

  if (formula.kind === "match") {
    const matchable = Math.min(deferral, formula.matchCapPct * comp);
    return Math.max(0, matchable * formula.matchRate);
  }

  // tiered
  const deferredPct = Math.min(1, deferral / comp);
  const tiers = [...formula.tiers].sort((a, b) => a.upToPct - b.upToPct);
  let floor = 0;
  let total = 0;
  for (const t of tiers) {
    const top = Math.min(t.upToPct, 1);
    const slice = Math.min(Math.max(deferredPct, floor), top) - floor;
    if (slice > 0) total += slice * comp * t.rate;
    floor = top;
    if (floor >= deferredPct) break;
  }
  return Math.max(0, total);
}
