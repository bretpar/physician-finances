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
