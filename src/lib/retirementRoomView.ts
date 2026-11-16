/**
 * Production retirement-room view.
 *
 * This is the ONLY place the Tax Savings retirement UI gets its numbers from,
 * and it is a thin adapter over `computeRetirementOpportunity`: it normalizes +
 * dedupes sources, calls the canonical engine twice (actual and projected), and
 * maps the result onto the existing presentation shapes. No independent limit,
 * capacity, IRA or catch-up math lives here.
 */

import {
  computeRetirementOpportunity,
  projectedNetBusinessProfit,
  type RetirementFilingStatus,
  type RetirementOpportunityResult,
  type PlanOpportunity,
} from "@/lib/retirementOpportunityEngine";
import {
  buildRetirementOpportunityInput,
  dedupeRetirementSources,
  type AmbiguousRetirementPair,
  type CanonicalCompany,
  type PaycheckRetirementSource,
  type StandaloneRetirementSource,
} from "@/lib/retirementCanonicalInput";
import { calculateSETax } from "@/lib/taxEngine";
import type { FilingStatus } from "@/lib/taxBrackets";
import type {
  CapacityBasis,
  EmployeeRoomSummary,
  IraRoomSummary,
  PlanCapacity,
} from "@/lib/retirementContributionRoom";

export interface RetirementRoomViewArgs {
  taxYear: number;
  dateOfBirth?: string | Date | null;
  filingStatus?: RetirementFilingStatus | null;
  magi?: number | null;
  coveredByWorkplacePlan?: boolean | null;
  spouseCoveredByWorkplacePlan?: boolean | null;
  livedWithSpouseDuringYear?: boolean | null;
  eligibleTaxableCompensation?: number | null;
  companies: CanonicalCompany[];
  paychecks: PaycheckRetirementSource[];
  standalone: StandaloneRetirementSource[];
  ira: { traditionalContributed: number; rothContributed: number };
  /** Actual YTD net business profit by company id. */
  actualNetProfitByCompany?: Map<string, number>;
  /** Remaining ACTIVE planned gross business income by company id. */
  remainingPlannedGrossByCompany?: Map<string, number>;
  /** Remaining planned business expenses by company id. */
  remainingPlannedExpensesByCompany?: Map<string, number>;
  /** When false, projected capacity is not reported. */
  includeProjection?: boolean;
  /**
   * Optional override for the deductible half of SE tax by company id. When
   * omitted the canonical SE-tax helper (`calculateSETax`) derives it from the
   * company's net profit, so self-employed earned income is always net of the
   * deductible half before the reduced employer contribution rate applies.
   */
  deductibleHalfSeTaxByCompany?: Map<string, number>;
  /**
   * Same-earner W-2 (FICA) wages, actual and projected, so the deductible half
   * of SE tax honours the shared per-person Social Security wage base.
   */
  w2WagesByEarner?: { actual: Map<string, number>; projected?: Map<string, number> };
}

export interface RetirementHeadline {
  /** Opportunity that is safe to add together (never past shared limits). */
  verifiedTotal: number;
  employeeRoom: number;
  iraRoom: number;
  employerVerified: number;
  /** Plans whose employer capacity is excluded pending verification. */
  needsVerificationPlanIds: string[];
  unknownEmployerCount: number;
}

export interface RetirementRoomView {
  engine: RetirementOpportunityResult;
  engineProjected: RetirementOpportunityResult | null;
  employeeRoom: EmployeeRoomSummary;
  plans: PlanCapacity[];
  employerContributionTotal: number;
  iraRoom: IraRoomSummary;
  /** Records that may describe the same contribution — flagged, not merged. */
  ambiguousDuplicates: AmbiguousRetirementPair[];
  zeroContributionCompanyIds: string[];
  /** Future scheduled contributions (projected run minus actual), by bucket. */
  scheduledEmployeeTotal: number;
  scheduledEmployerTotal: number;
  /** True when duplicate attribution / classification needs reconciliation. */
  needsReconciliation: boolean;
  headline: RetirementHeadline;
}

/**
 * Headline "additional opportunity". Employee room, IRA room and employer
 * capacity are only summed where that cannot exceed a shared limit:
 *  - employer capacity in a group is clipped to the group's remaining §415(c)
 *    headroom after the earner's remaining employee room (conservative);
 *  - capacity flagged unverified (possibly related employers) is excluded.
 */
export function computeRetirementHeadline(
  engine: RetirementOpportunityResult,
  projected: RetirementOpportunityResult | null,
): RetirementHeadline {
  const projectedById = new Map((projected?.plans ?? []).map((p) => [p.planId, p]));
  const plans = engine.plans.filter((p) => p.deferralBucket !== "governmental_457b");
  const primary402g = engine.plans.some((p) => p.deferralBucket === "402g" && p.earner !== "spouse");
  const roomFor = (earner: string) =>
    earner === "spouse"
      ? (engine.spouseEmployee402g?.remaining ?? 0)
      : primary402g
        ? engine.employee402g.remaining
        : (engine.simple?.remaining ?? 0);
  const employeeRoom = roomFor("primary") + (engine.spouseEmployee402g?.remaining ?? 0);
  const iraRoom = engine.ira.remainingContributionRoom ?? 0;
  let employerVerified = 0;
  const needsVerificationPlanIds: string[] = [];
  let unknownEmployerCount = 0;
  for (const plan of plans) {
    const view = projectedById.get(plan.planId) ?? plan;
    const cap = view.employerCapacityRemaining;
    if (cap == null) {
      if (view.reasons.includes("unknown_plan_data")) unknownEmployerCount++;
      continue;
    }
    if (view.capacityUnverified) {
      if (plan.planId) needsVerificationPlanIds.push(plan.planId);
      continue;
    }
    const selfEmployed = view.entityKind === "schedule_c" || view.entityKind === "partnership_k1";
    const clip =
      selfEmployed && view.deferralBucket === "402g" && view.additionsHeadroom != null
        ? Math.max(0, view.additionsHeadroom - roomFor(view.earner))
        : Infinity;
    employerVerified += Math.min(cap, clip);
  }
  return {
    verifiedTotal: employeeRoom + (engine.governmental457b?.remaining ?? 0) + iraRoom + employerVerified,
    employeeRoom,
    iraRoom,
    employerVerified,
    needsVerificationPlanIds,
    unknownEmployerCount,
  };
}

function basisFor(plan: PlanOpportunity, capacity: number | null): CapacityBasis {
  if (capacity == null) return "unknown";
  if (plan.reasons.includes("compensation_limit")) return "compensation";
  return "plan_limit";
}

export function computeRetirementRoomView(args: RetirementRoomViewArgs): RetirementRoomView {
  const sources = dedupeRetirementSources({
    paychecks: args.paychecks,
    standalone: args.standalone,
  });

  /* Canonical projected net PROFIT (never YTD profit + future gross). */
  const projectedNetProfitByCompany = new Map<string, number>();
  for (const c of args.companies) {
    const actual = args.actualNetProfitByCompany?.get(c.id);
    if (actual == null && !args.remainingPlannedGrossByCompany?.has(c.id)) continue;
    projectedNetProfitByCompany.set(
      c.id,
      projectedNetBusinessProfit({
        actualYtdNetProfit: actual ?? 0,
        remainingPlannedGrossIncome: args.remainingPlannedGrossByCompany?.get(c.id) ?? 0,
        remainingPlannedExpenses: args.remainingPlannedExpensesByCompany?.get(c.id) ?? 0,
      }),
    );
  }

  /* Self-employed earned income must be NET of the deductible half of SE tax
     before the reduced employer rate applies. The authoritative SE-tax helper
     is reused here — no SE formula is duplicated, and the employer retirement
     deduction never feeds back into the SE-tax base. */
  const seFilingStatus = (args.filingStatus ?? "single") as FilingStatus;
  const earnerOf = (id: string) =>
    args.companies.find((c) => c.id === id)?.employeeRole === "spouse" ? "spouse" : "primary";
  const halfSeTax = (profit: number | undefined, companyId: string, projected: boolean) => {
    if (profit == null || profit <= 0) return 0;
    const wages =
      (projected ? args.w2WagesByEarner?.projected : undefined)?.get(earnerOf(companyId)) ??
      args.w2WagesByEarner?.actual.get(earnerOf(companyId)) ??
      0;
    return calculateSETax(profit, seFilingStatus, undefined, wages, wages, undefined, undefined, wages)
      .deductibleHalf;
  };
  const deductibleHalfSeTaxByCompany = new Map<string, number>();
  const projectedDeductibleHalfSeTaxByCompany = new Map<string, number>();
  for (const c of args.companies) {
    const override = args.deductibleHalfSeTaxByCompany?.get(c.id);
    deductibleHalfSeTaxByCompany.set(
      c.id,
      override ?? halfSeTax(args.actualNetProfitByCompany?.get(c.id), c.id, false),
    );
    projectedDeductibleHalfSeTaxByCompany.set(
      c.id,
      halfSeTax(projectedNetProfitByCompany.get(c.id), c.id, true),
    );
  }

  const common = {
    taxYear: args.taxYear,
    dateOfBirth: args.dateOfBirth ?? null,
    filingStatus: args.filingStatus ?? null,
    magi: args.magi ?? null,
    coveredByWorkplacePlan: args.coveredByWorkplacePlan ?? null,
    spouseCoveredByWorkplacePlan: args.spouseCoveredByWorkplacePlan ?? null,
    livedWithSpouseDuringYear: args.livedWithSpouseDuringYear ?? null,
    eligibleTaxableCompensation: args.eligibleTaxableCompensation ?? null,
    companies: args.companies,
    sources,
    actualNetProfitByCompany: args.actualNetProfitByCompany,
    projectedNetProfitByCompany,
    deductibleHalfSeTaxByCompany,
    projectedDeductibleHalfSeTaxByCompany,
    ira: args.ira,
  };

  const built = buildRetirementOpportunityInput(common);
  const engine = computeRetirementOpportunity(built.input);
  const engineProjected =
    args.includeProjection === false
      ? null
      : computeRetirementOpportunity(
          buildRetirementOpportunityInput(common, { projected: true }).input,
        );

  /* Employee elective-deferral room — one shared §402(g) bucket, plus the
     separate SIMPLE bucket contributions that also consume it. */
  const employeeContributionTotal =
    engine.employee402g.contributed + (engine.simple?.contributed ?? 0);
  const employeeRoom: EmployeeRoomSummary = {
    employeeContributionTotal,
    employeeDeferralLimit: engine.employee402g.limit,
    catchUpAllowed: engine.employee402g.catchUp,
    employeeRemainingRoom: engine.employee402g.remaining,
    employeeUsedFraction:
      engine.employee402g.limit > 0
        ? Math.min(1, employeeContributionTotal / engine.employee402g.limit)
        : 0,
  };

  const projectedById = new Map((engineProjected?.plans ?? []).map((p) => [p.planId, p]));

  const plans: PlanCapacity[] = engine.plans
    .filter((p) => p.employeeContribution > 0 || p.employerContribution > 0 || p.companyId != null)
    .map((p) => {
      const proj = p.planId ? projectedById.get(p.planId) : undefined;
      const current = p.employerCapacityRemaining;
      const projected = proj?.employerCapacityRemaining ?? null;
      return {
        companyId: p.companyId,
        companyName: p.companyName,
        planType: p.planKind,
        employeeContribution: p.employeeContribution,
        employerContribution: p.employerContribution,
        planContributionTotal: p.totalAdditions,
        planCurrentCapacity: current,
        planProjectedCapacity: projected,
        currentBasis: basisFor(p, current),
        projectedBasis: proj ? basisFor(proj, projected) : "unknown",
      };
    });

  const employerContributionTotal = engine.plans.reduce(
    (s, p) => s + p.employerContribution,
    0,
  );

  const iraRoom: IraRoomSummary = {
    traditionalTotal: engine.ira.traditionalContributed,
    rothTotal: engine.ira.rothContributed,
    combinedTotal: engine.ira.combinedContributed,
    // Display falls back to the statutory limit when compensation is unknown;
    // remaining room stays 0 so no phantom capacity is implied.
    limit: engine.ira.combinedLimit ?? engine.ira.statutoryCombinedLimit,
    remainingRoom: engine.ira.remainingContributionRoom ?? 0,
  };

  const sumProjected = (key: "employeeContribution" | "employerContribution") =>
    engineProjected ? engineProjected.plans.reduce((s, p) => s + p[key], 0) : 0;
  const sumActual = (key: "employeeContribution" | "employerContribution") =>
    engine.plans.reduce((s, p) => s + p[key], 0);
  const scheduledEmployeeTotal = engineProjected
    ? Math.max(0, sumProjected("employeeContribution") - sumActual("employeeContribution"))
    : 0;
  const scheduledEmployerTotal = engineProjected
    ? Math.max(0, sumProjected("employerContribution") - sumActual("employerContribution"))
    : 0;
  const needsReconciliation =
    sources.ambiguous.length > 0 ||
    [...engine.plans, ...(engineProjected?.plans ?? [])].some(
      (p) => p.capacityUnverified || p.reasons.includes("sep_employee_deferral_not_allowed"),
    );

  return {
    engine,
    engineProjected,
    scheduledEmployeeTotal,
    scheduledEmployerTotal,
    needsReconciliation,
    headline: computeRetirementHeadline(engine, engineProjected),
    employeeRoom,
    plans,
    employerContributionTotal,
    iraRoom,
    ambiguousDuplicates: sources.ambiguous,
    zeroContributionCompanyIds: built.zeroContributionCompanyIds,
  };
}
