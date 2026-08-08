/**
 * Retirement contribution-room calculations.
 *
 * Deliberately separate from Tax Savings deduction math
 * (`src/lib/taxSavingsDeductions.ts`): contribution totals track plan limits,
 * deduction totals track taxable-income reduction. Employer contributions
 * count toward plan limits here but never become a personal deduction.
 *
 * Concepts (kept distinct on purpose):
 *  - employeeContributionTotal / employeeDeferralLimit / employeeRemainingRoom
 *    → ONE aggregate elective-deferral limit across all plans.
 *  - employerContributionTotal / planContributionTotal / planCurrentCapacity /
 *    planProjectedCapacity → per company/plan, never pooled across plans.
 */

export interface RetirementYearLimits {
  /** 402(g) employee elective-deferral limit. */
  employeeDeferral: number;
  /** 415(c) overall annual additions limit (employee + employer) per plan. */
  overallPlan: number;
}

/** Statutory limits by tax year. Add new years here — never inline in components. */
export const RETIREMENT_LIMITS_BY_YEAR: Record<number, RetirementYearLimits> = {
  2024: { employeeDeferral: 23_000, overallPlan: 69_000 },
  2025: { employeeDeferral: 23_500, overallPlan: 70_000 },
  2026: { employeeDeferral: 24_500, overallPlan: 72_000 },
};

const LATEST_YEAR = Math.max(...Object.keys(RETIREMENT_LIMITS_BY_YEAR).map(Number));

export function getRetirementLimits(taxYear: number): RetirementYearLimits {
  return RETIREMENT_LIMITS_BY_YEAR[taxYear] ?? RETIREMENT_LIMITS_BY_YEAR[LATEST_YEAR];
}

export function getEmployeeDeferralLimit(taxYear: number, extraCatchUp = 0): number {
  return getRetirementLimits(taxYear).employeeDeferral + nonNeg(extraCatchUp);
}

export function getOverallPlanLimit(taxYear: number, extraCatchUp = 0): number {
  return getRetirementLimits(taxYear).overallPlan + nonNeg(extraCatchUp);
}

const nonNeg = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/* ── Employee elective-deferral room (aggregate, one limit) ─────────────── */

export interface EmployeeRoomInput {
  taxYear: number;
  /** Employee elective deferrals across every company/plan. */
  employeeContributions: number[];
  /**
   * Extra catch-up room, only when the app already resolves age-based
   * catch-up elsewhere. No new catch-up system is introduced here.
   */
  extraCatchUp?: number;
}

export interface EmployeeRoomSummary {
  employeeContributionTotal: number;
  employeeDeferralLimit: number;
  employeeRemainingRoom: number;
  /** 0–1 progress toward the deferral limit. */
  employeeUsedFraction: number;
}

export function computeEmployeeContributionRoom(input: EmployeeRoomInput): EmployeeRoomSummary {
  const employeeContributionTotal = input.employeeContributions.reduce((s, n) => s + nonNeg(n), 0);
  const employeeDeferralLimit = getEmployeeDeferralLimit(input.taxYear, input.extraCatchUp ?? 0);
  return {
    employeeContributionTotal,
    employeeDeferralLimit,
    employeeRemainingRoom: Math.max(0, employeeDeferralLimit - employeeContributionTotal),
    employeeUsedFraction:
      employeeDeferralLimit > 0 ? Math.min(1, employeeContributionTotal / employeeDeferralLimit) : 0,
  };
}

/* ── Per company/plan capacity ──────────────────────────────────────────── */

export interface PlanInput {
  companyId: string | null;
  companyName: string;
  /** Company/plan type when known (e.g. w2, 1099_schedule_c). */
  planType?: string | null;
  /**
   * Eligible compensation recorded so far — W-2 wages for employees, existing
   * business-profit figures for self-employed plans. `null` when unknown.
   */
  eligibleCompensationYtd: number | null;
  /** YTD actual + remaining planned eligible compensation. `null` when unknown. */
  projectedEligibleCompensation?: number | null;
  employeeContribution: number;
  employerContribution: number;
}

export type CapacityBasis = "compensation" | "plan_limit" | "unknown";

export interface PlanCapacity {
  companyId: string | null;
  companyName: string;
  planType?: string | null;
  employeeContribution: number;
  employerContribution: number;
  planContributionTotal: number;
  /** Remaining room in this plan from actual data. `null` = not safely computable. */
  planCurrentCapacity: number | null;
  /** Remaining room using projected eligible compensation. `null` = unavailable. */
  planProjectedCapacity: number | null;
  currentBasis: CapacityBasis;
  projectedBasis: CapacityBasis;
}

function capacityFor(
  compensation: number | null | undefined,
  overallLimit: number,
  contributed: number,
): { capacity: number | null; basis: CapacityBasis } {
  if (compensation == null || !Number.isFinite(Number(compensation)) || Number(compensation) <= 0) {
    return { capacity: null, basis: "unknown" };
  }
  const comp = Number(compensation);
  const applicable = Math.min(overallLimit, comp);
  return {
    capacity: Math.max(0, applicable - contributed),
    basis: comp < overallLimit ? "compensation" : "plan_limit",
  };
}

export function computePlanCapacities(taxYear: number, plans: PlanInput[], extraCatchUp = 0): PlanCapacity[] {
  const overallLimit = getOverallPlanLimit(taxYear, extraCatchUp);
  return plans.map((p) => {
    const employeeContribution = nonNeg(p.employeeContribution);
    const employerContribution = nonNeg(p.employerContribution);
    const planContributionTotal = employeeContribution + employerContribution;
    const current = capacityFor(p.eligibleCompensationYtd, overallLimit, planContributionTotal);
    const projected = capacityFor(
      p.projectedEligibleCompensation ?? null,
      overallLimit,
      planContributionTotal,
    );
    return {
      companyId: p.companyId,
      companyName: p.companyName,
      planType: p.planType ?? null,
      employeeContribution,
      employerContribution,
      planContributionTotal,
      planContributionTotal_: undefined,
      planCurrentCapacity: current.capacity,
      planProjectedCapacity: projected.capacity,
      currentBasis: current.basis,
      projectedBasis: projected.basis,
    } as PlanCapacity;
  });
}

export function sumEmployerContributions(plans: Pick<PlanCapacity, "employerContribution">[]): number {
  return plans.reduce((s, p) => s + nonNeg(p.employerContribution), 0);
}

/* ── Income Planner: remaining planned compensation ─────────────────────── */

export interface PlannerOccurrence {
  date: string;
  grossAmount: number;
  matchStatus: string;
  /** companies.id linked to the planner stream. */
  streamSourceId?: string | null;
}

/**
 * Remaining planned (not yet actual) gross income per company for the tax year.
 * Only `active` occurrences dated today or later count — converted, matched,
 * suggested, skipped and past_due occurrences are excluded so income already
 * present in actuals is never double counted.
 */
export function sumRemainingPlannedIncomeByCompany(
  occurrences: PlannerOccurrence[],
  taxYear: number,
  todayISO: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const o of occurrences) {
    if (o.matchStatus !== "active") continue;
    if (!o.date || Number(o.date.slice(0, 4)) !== taxYear) continue;
    if (o.date < todayISO) continue;
    const key = o.streamSourceId || "";
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + nonNeg(o.grossAmount));
  }
  return map;
}
