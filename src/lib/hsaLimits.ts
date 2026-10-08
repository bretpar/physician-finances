/**
 * Centralized HSA annual contribution limits by tax year.
 *
 * ALL HSA-limit reads MUST go through this file. Do not scatter numeric
 * limits across components — add new tax years here and every consumer
 * (Tax Overview, Deductions page, Reports, PDF, tax engine cap) will
 * pick them up automatically.
 *
 * Sources:
 *   IRS Rev. Proc. 2022-24 (2023), 2023-23 (2024), 2024-25 (2025), 2025-19 (2026).
 */

export type HsaCoverageType = "individual" | "family";

export interface HsaLimits {
  taxYear: number;
  /** Statutory HSA contribution limit for self-only HDHP coverage. */
  individual: number;
  /** Statutory HSA contribution limit for family HDHP coverage. */
  family: number;
  /** Age 55+ catch-up contribution add-on (flat by law, no COLA). */
  catchUp: number;
}

export const HSA_LIMITS_BY_YEAR: Record<number, HsaLimits> = {
  2023: { taxYear: 2023, individual: 3850, family: 7750, catchUp: 1000 },
  2024: { taxYear: 2024, individual: 4150, family: 8300, catchUp: 1000 },
  2025: { taxYear: 2025, individual: 4300, family: 8550, catchUp: 1000 },
  2026: { taxYear: 2026, individual: 4400, family: 8750, catchUp: 1000 },
};

/** Latest known tax year (highest key in HSA_LIMITS_BY_YEAR). */
export function latestHsaLimitYear(): number {
  return Math.max(...Object.keys(HSA_LIMITS_BY_YEAR).map((k) => Number(k)));
}

/**
 * Returns the HSA limit table for a specific tax year. Falls back to the
 * latest year's table if `year` isn't in the registry (safer than throwing
 * for downstream UI — historical reports still render, and future years
 * inherit the most recent known limits until we add them).
 */
export function getHsaLimits(year: number): HsaLimits {
  return HSA_LIMITS_BY_YEAR[year] ?? HSA_LIMITS_BY_YEAR[latestHsaLimitYear()];
}

/**
 * Returns the applicable annual HSA contribution limit for a given
 * coverage type and age-55 catch-up eligibility.
 */
export function getApplicableHsaLimit(
  year: number,
  coverage: HsaCoverageType,
  catchUpEligible: boolean,
): number {
  const t = getHsaLimits(year);
  const base = coverage === "family" ? t.family : t.individual;
  return base + (catchUpEligible ? t.catchUp : 0);
}

/* ───────────── Coverage periods (partial-year eligibility) ───────────── */

/** User-facing health-insurance coverage tier. */
export type HealthCoverageTier = "employee_only" | "employee_spouse" | "employee_children" | "family";

export interface HsaCoveragePeriod {
  /** Inclusive start date (YYYY-MM-DD). */
  start: string;
  /** Inclusive end date (YYYY-MM-DD). Null = open-ended. */
  end: string | null;
  tier: HealthCoverageTier;
  /** True when the plan is an HSA-eligible HDHP. */
  hsaEligible: boolean;
}

export const COVERAGE_TIER_LABELS: Record<HealthCoverageTier, string> = {
  employee_only: "Employee only",
  employee_spouse: "Employee + spouse",
  employee_children: "Employee + child(ren)",
  family: "Family",
};

/** Derived IRS HSA classification for a coverage tier. */
export function irsHsaCoverageForTier(tier: HealthCoverageTier): HsaCoverageType {
  return tier === "employee_only" ? "individual" : "family";
}

export interface MonthEligibility {
  month: number; // 1-12
  coverage: HsaCoverageType | null; // null = not HSA-eligible
}

/** Eligibility determined on the first day of each month. */
export function monthlyHsaEligibility(year: number, periods: HsaCoveragePeriod[]): MonthEligibility[] {
  const out: MonthEligibility[] = [];
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${String(m).padStart(2, "0")}-01`;
    const p = periods.find((x) => x.start <= first && (x.end == null || x.end >= first));
    out.push({ month: m, coverage: p && p.hsaEligible ? irsHsaCoverageForTier(p.tier) : null });
  }
  return out;
}

/**
 * Applicable HSA limit. With coverage periods, prorates monthly:
 * Σ eligible months (annual limit for that month's coverage / 12), with
 * the age-55 catch-up prorated the same way. Without periods, falls back
 * to the full-year legacy coverage type. Years before the first recorded
 * period also retain that legacy limit; no historical coverage was recorded.
 */
export function resolveApplicableHsaLimit(
  year: number,
  legacyCoverage: HsaCoverageType,
  catchUpEligible: boolean,
  periods?: HsaCoveragePeriod[] | null,
): number {
  if (!periods || periods.length === 0) return getApplicableHsaLimit(year, legacyCoverage, catchUpEligible);
  const yearEnd = `${year}-12-31`;
  if (periods.every((period) => period.start > yearEnd)) {
    return getApplicableHsaLimit(year, legacyCoverage, catchUpEligible);
  }
  let total = 0;
  for (const m of monthlyHsaEligibility(year, periods)) {
    if (!m.coverage) continue;
    total += getApplicableHsaLimit(year, m.coverage, catchUpEligible) / 12;
  }
  return Math.round(total * 100) / 100;
}

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Compact summary, e.g. "Family Jan–Aug · Not eligible Sep–Dec". */
export function summarizeHsaEligibility(year: number, periods: HsaCoveragePeriod[]): string {
  const months = monthlyHsaEligibility(year, periods);
  const parts: string[] = [];
  let i = 0;
  while (i < 12) {
    const c = months[i].coverage;
    let j = i;
    while (j + 1 < 12 && months[j + 1].coverage === c) j++;
    const label = c === "family" ? "Family" : c === "individual" ? "Self-only" : "Not eligible";
    parts.push(i === 0 && j === 11 ? `${label} all year` : `${label} ${MON[i]}${i === j ? "" : `–${MON[j]}`}`);
    i = j + 1;
  }
  return parts.join(" · ");
}
