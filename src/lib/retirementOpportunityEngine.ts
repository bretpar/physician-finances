/**
 * Canonical Retirement Opportunity Engine (Phase 1).
 *
 * PURE calculation layer: no Supabase, no React, no clock reads except the
 * explicit `asOf` inputs callers pass in. Everything retirement-related that
 * concerns limits, eligibility, deductibility and employer capacity should be
 * derived here so pages/hooks never re-implement retirement math.
 *
 * Deliberate separations kept throughout:
 *  - contribution ROOM (plan limits) vs tax DEDUCTIBILITY
 *  - employee elective deferrals (§402(g)) vs governmental 457(b) vs SIMPLE
 *  - employee money vs employer money (employer W-2 money is never a personal
 *    deduction; self-employed employer money is)
 *  - known plan data vs `unknown_plan_data` (never fabricate opportunity)
 */

/* ────────────────────────────── Reason codes ────────────────────────────── */

export type RetirementReasonCode =
  | "employee_402g_limit"
  | "governmental_457b_limit"
  | "simple_plan_limit"
  | "plan_415c_limit"
  | "compensation_limit"
  | "self_employed_employer_formula"
  | "traditional_ira_magi_phaseout"
  | "roth_ira_magi_phaseout"
  | "insufficient_taxable_compensation"
  /** MAGI is required to evaluate an IRA phaseout but was not supplied. */
  | "magi_unknown"
  /** Eligible taxable compensation unknown → IRA capacity is unknown. */
  | "compensation_unknown"
  /** MFS: the lived-with-spouse fact materially changes the answer. */
  | "mfs_spouse_status_unknown"
  /** A SEP IRA row was recorded as an employee elective deferral. */
  | "sep_employee_deferral_not_allowed"
  /** Two records may describe the same contribution; both were preserved. */
  | "duplicate_contribution_ambiguous"
  | "unknown_plan_data";

/* ─────────────────────────────── Rule tables ────────────────────────────── */

export type RetirementFilingStatus =
  | "single"
  | "head_of_household"
  | "married_filing_jointly"
  | "married_filing_separately";

export interface PhaseoutRange {
  start: number;
  end: number;
}

export interface RetirementYearRules {
  /** §402(g) employee elective deferral limit (401(k)/403(b)/TSP/Solo 401(k)). */
  employeeDeferral: number;
  /** §415(c) overall annual additions limit, per unrelated employer plan. */
  annualAdditions: number;
  /** §401(a)(17) compensation cap. */
  compensationCap: number;
  /** §414(v) age-50+ catch-up. */
  catchUp50: number;
  /** SECURE 2.0 §109 higher catch-up for ages 60–63. */
  catchUp60to63: number;
  /** Governmental 457(b) — its OWN bucket, not shared with §402(g). */
  governmental457b: { limit: number; catchUp50: number; catchUp60to63: number };
  /** SIMPLE IRA / SIMPLE 401(k) — its own lower limit. */
  simple: { limit: number; catchUp50: number; catchUp60to63: number };
  /** §219 IRA annual limit (Traditional + Roth combined). */
  ira: { limit: number; catchUp50: number };
  /** Traditional IRA deduction MAGI phaseouts. */
  traditionalIraPhaseouts: {
    coveredSingle: PhaseoutRange;
    coveredMarriedJoint: PhaseoutRange;
    uncoveredWithCoveredSpouse: PhaseoutRange;
    marriedFilingSeparatelyCovered: PhaseoutRange;
  };
  /** Direct Roth IRA contribution MAGI phaseouts. */
  rothIraPhaseouts: {
    single: PhaseoutRange;
    marriedJoint: PhaseoutRange;
    marriedFilingSeparately: PhaseoutRange;
  };
}

export const RETIREMENT_RULES_BY_YEAR: Record<number, RetirementYearRules> = {
  2024: {
    employeeDeferral: 23_000,
    annualAdditions: 69_000,
    compensationCap: 345_000,
    catchUp50: 7_500,
    catchUp60to63: 7_500,
    governmental457b: { limit: 23_000, catchUp50: 7_500, catchUp60to63: 7_500 },
    simple: { limit: 16_000, catchUp50: 3_500, catchUp60to63: 3_500 },
    ira: { limit: 7_000, catchUp50: 1_000 },
    traditionalIraPhaseouts: {
      coveredSingle: { start: 77_000, end: 87_000 },
      coveredMarriedJoint: { start: 123_000, end: 143_000 },
      uncoveredWithCoveredSpouse: { start: 230_000, end: 240_000 },
      marriedFilingSeparatelyCovered: { start: 0, end: 10_000 },
    },
    rothIraPhaseouts: {
      single: { start: 146_000, end: 161_000 },
      marriedJoint: { start: 230_000, end: 240_000 },
      marriedFilingSeparately: { start: 0, end: 10_000 },
    },
  },
  2025: {
    employeeDeferral: 23_500,
    annualAdditions: 70_000,
    compensationCap: 350_000,
    catchUp50: 7_500,
    catchUp60to63: 11_250,
    governmental457b: { limit: 23_500, catchUp50: 7_500, catchUp60to63: 11_250 },
    simple: { limit: 16_500, catchUp50: 3_500, catchUp60to63: 5_250 },
    ira: { limit: 7_000, catchUp50: 1_000 },
    traditionalIraPhaseouts: {
      coveredSingle: { start: 79_000, end: 89_000 },
      coveredMarriedJoint: { start: 126_000, end: 146_000 },
      uncoveredWithCoveredSpouse: { start: 236_000, end: 246_000 },
      marriedFilingSeparatelyCovered: { start: 0, end: 10_000 },
    },
    rothIraPhaseouts: {
      single: { start: 150_000, end: 165_000 },
      marriedJoint: { start: 236_000, end: 246_000 },
      marriedFilingSeparately: { start: 0, end: 10_000 },
    },
  },
  2026: {
    employeeDeferral: 24_500,
    annualAdditions: 72_000,
    compensationCap: 360_000,
    catchUp50: 8_000,
    catchUp60to63: 11_250,
    governmental457b: { limit: 24_500, catchUp50: 8_000, catchUp60to63: 11_250 },
    simple: { limit: 17_000, catchUp50: 4_000, catchUp60to63: 5_250 },
    ira: { limit: 7_500, catchUp50: 1_100 },
    traditionalIraPhaseouts: {
      coveredSingle: { start: 81_000, end: 91_000 },
      coveredMarriedJoint: { start: 129_000, end: 149_000 },
      uncoveredWithCoveredSpouse: { start: 242_000, end: 252_000 },
      marriedFilingSeparatelyCovered: { start: 0, end: 10_000 },
    },
    rothIraPhaseouts: {
      single: { start: 153_000, end: 168_000 },
      marriedJoint: { start: 242_000, end: 252_000 },
      marriedFilingSeparately: { start: 0, end: 10_000 },
    },
  },
};

const LATEST_RULE_YEAR = Math.max(...Object.keys(RETIREMENT_RULES_BY_YEAR).map(Number));

export function getRetirementRules(taxYear: number): RetirementYearRules {
  return RETIREMENT_RULES_BY_YEAR[taxYear] ?? RETIREMENT_RULES_BY_YEAR[LATEST_RULE_YEAR];
}

/* ──────────────────────────────── Helpers ───────────────────────────────── */

const nonNeg = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** Age ATTAINED during the tax year (IRS whole-year rule). */
export function ageAttainedInYear(
  dateOfBirth: string | Date | null | undefined,
  taxYear: number,
): number | null {
  if (!dateOfBirth) return null;
  const birthYear =
    dateOfBirth instanceof Date
      ? dateOfBirth.getFullYear()
      : Number(String(dateOfBirth).slice(0, 4));
  if (!Number.isFinite(birthYear) || birthYear < 1900) return null;
  const age = taxYear - birthYear;
  return age >= 0 ? age : null;
}

type CatchUpTier = { catchUp50: number; catchUp60to63: number };

function catchUpFor(tier: CatchUpTier, age: number | null | undefined): number {
  if (age == null || !Number.isFinite(Number(age))) return 0;
  const a = Number(age);
  if (a >= 60 && a <= 63) return tier.catchUp60to63;
  if (a >= 50) return tier.catchUp50;
  return 0;
}

/** Elective-deferral catch-up for the shared §402(g) bucket. */
export function getDeferralCatchUp(taxYear: number, age: number | null | undefined): number {
  return catchUpFor(getRetirementRules(taxYear), age);
}

/**
 * IRS partial-phaseout allowance: prorate `maxAmount` across the MAGI range,
 * round UP to the next $10, and apply the $200 statutory minimum when any
 * allowance remains. Reusable for Traditional IRA deduction and Roth
 * eligibility — never re-implement this per page.
 */
export function prorateForPhaseout(
  maxAmount: number,
  magi: number,
  range: PhaseoutRange,
): number {
  const max = nonNeg(maxAmount);
  if (max <= 0) return 0;
  const span = range.end - range.start;
  if (span <= 0) return magi < range.end ? max : 0;
  if (magi <= range.start) return max;
  if (magi >= range.end) return 0;
  const raw = max * ((range.end - magi) / span);
  const roundedUpToTen = Math.ceil(raw / 10) * 10;
  const withMinimum = Math.max(roundedUpToTen, 200);
  return Math.min(max, withMinimum);
}

/* ───────────────────────────── Plan/entity kinds ────────────────────────── */

export type RetirementPlanKind =
  | "401k"
  | "403b"
  | "tsp"
  | "solo_401k"
  | "governmental_457b"
  | "simple_ira"
  | "simple_401k"
  | "sep_ira";

export type RetirementEntityKind =
  | "w2"
  | "s_corp"
  | "schedule_c"
  | "partnership_k1"
  | "unknown";

/** Which employee elective-deferral bucket a plan's employee money belongs to. */
export type DeferralBucket = "402g" | "governmental_457b" | "simple" | "none";

export function getDeferralBucket(planKind: RetirementPlanKind): DeferralBucket {
  switch (planKind) {
    case "401k":
    case "403b":
    case "tsp":
    case "solo_401k":
      return "402g";
    case "governmental_457b":
      return "governmental_457b";
    case "simple_ira":
    case "simple_401k":
      return "simple";
    case "sep_ira":
    default:
      return "none";
  }
}

/** Self-employed entities whose employer contribution is a personal deduction. */
const SELF_EMPLOYED_ENTITIES: RetirementEntityKind[] = ["schedule_c", "partnership_k1"];

/* ───────────────────────────────── Inputs ───────────────────────────────── */

export interface PlanOpportunityInput {
  planId?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  planKind: RetirementPlanKind;
  entityKind: RetirementEntityKind;
  /** Employee elective deferrals already made to THIS plan. */
  employeeContribution?: number | null;
  /** Employer / profit-sharing money already contributed to THIS plan. */
  employerContribution?: number | null;
  /** Eligible W-2 wages (W-2 and S-corp plans). `null` when unknown. */
  w2Wages?: number | null;
  /** Net business profit for self-employed plans. `null` when unknown. */
  netBusinessProfit?: number | null;
  /** Deductible half of SE tax attributable to this business. */
  deductibleHalfSeTax?: number | null;
  /**
   * Nominal employer contribution rate the plan document allows (e.g. 0.25).
   * `null`/undefined => formula unknown.
   */
  employerContributionRate?: number | null;
  /**
   * W-2 employer plans only: set true when the match/profit-sharing formula is
   * actually known. Otherwise employer capacity is reported as unknown.
   */
  employerFormulaKnown?: boolean | null;
  /**
   * Partnership K-1 only: the portion of K-1 income that is earned income for
   * services (guaranteed payments / active SE earnings). Passive distributions
   * must NOT be passed here.
   */
  k1EarnedIncomeFromServices?: number | null;
  /** 457(b) final-three-years catch-up metadata (unsupported → data needed). */
  requestsSpecial457Catchup?: boolean | null;
}

export interface RetirementOpportunityInput {
  taxYear: number;
  dateOfBirth?: string | Date | null;
  /** Age attained in the tax year, when DOB is unavailable. */
  age?: number | null;
  filingStatus?: RetirementFilingStatus | null;
  /** Modified AGI used for IRA rules. `null` => phaseouts cannot be applied. */
  magi?: number | null;
  /** Workplace-plan coverage for the contributor. */
  coveredByWorkplacePlan?: boolean | null;
  spouseCoveredByWorkplacePlan?: boolean | null;
  /** Taxable compensation eligible to support IRA contributions. */
  eligibleTaxableCompensation?: number | null;
  /**
   * MFS only: did the taxpayer live with their spouse at any time during the
   * tax year? `null`/undefined => unknown; the engine refuses to assume the
   * favorable (single-like) treatment.
   */
  livedWithSpouseDuringYear?: boolean | null;
  plans?: PlanOpportunityInput[];
  ira?: {
    traditionalContributed?: number | null;
    rothContributed?: number | null;
  };
}

/* ───────────────────────────────── Outputs ──────────────────────────────── */

export interface DeferralBucketResult {
  contributed: number;
  limit: number;
  remaining: number;
  catchUp: number;
  reasons: RetirementReasonCode[];
}

export interface IraResult {
  combinedContributed: number;
  /** Compensation-capped combined IRA limit. `null` when compensation unknown. */
  combinedLimit: number | null;
  /** Statutory combined limit ignoring compensation — display/reference only. */
  statutoryCombinedLimit: number;
  /** `null` when contribution capacity cannot be established. */
  remainingContributionRoom: number | null;
  /** True when eligible taxable compensation was not supplied. */
  capacityUnknown: boolean;

  traditionalContributed: number;
  /** 0 when deductibility cannot be established — see `deductibilityUnknown`. */
  traditionalDeductible: number;
  traditionalNondeductible: number;
  /** Statutory phased deductible ceiling. `null` when it cannot be evaluated. */
  traditionalDeductibleCeiling: number | null;
  /** True when required data (MAGI / MFS status) is missing. */
  deductibilityUnknown: boolean;

  rothContributed: number;
  /** `null` when direct-Roth eligibility cannot be established. */
  rothAllowed: number | null;
  rothRemaining: number | null;
  rothEligibilityUnknown: boolean;

  eligibleTaxableCompensation: number | null;
  reasons: RetirementReasonCode[];
}

export interface PlanOpportunity {
  planId: string | null;
  companyId: string | null;
  companyName: string;
  planKind: RetirementPlanKind;
  entityKind: RetirementEntityKind;
  deferralBucket: DeferralBucket;
  employeeContribution: number;
  employerContribution: number;
  totalAdditions: number;
  /** §415(c) ceiling for this plan, capped by eligible compensation when known. */
  annualAdditionsLimit: number | null;
  /** Remaining employer/profit-sharing capacity. `null` = not computable. */
  employerCapacityRemaining: number | null;
  /** Eligible compensation the capacity math used. `null` when unknown. */
  eligibleCompensation: number | null;
  reasons: RetirementReasonCode[];
}

export interface RetirementTaxRouting {
  /** Employee pre-tax elective deferrals (all plan buckets). */
  employeePreTaxDeduction: number;
  /** Deductible Traditional IRA only. */
  traditionalIraDeduction: number;
  /** Self-employed employer contributions (Solo 401(k)/SEP profit sharing). */
  selfEmployedEmployerDeduction: number;
  /** W-2 / S-corp employer money — excluded from personal deductions. */
  w2EmployerExcluded: number;
  /** Roth is never deductible. */
  rothDeduction: 0;
}

export interface RetirementOpportunityResult {
  taxYear: number;
  employee402g: DeferralBucketResult;
  governmental457b?: DeferralBucketResult;
  ira: IraResult;
  plans: PlanOpportunity[];
  taxRouting: RetirementTaxRouting;
  /** SIMPLE bucket, present only when a SIMPLE plan exists. */
  simple?: DeferralBucketResult;
}

/* ───────────────────────────── IRA sub-engine ───────────────────────────── */

function iraCombinedLimit(taxYear: number, age: number | null): number {
  const rules = getRetirementRules(taxYear);
  return rules.ira.limit + (age != null && age >= 50 ? rules.ira.catchUp50 : 0);
}

export function computeIraOpportunity(input: {
  taxYear: number;
  age: number | null;
  filingStatus: RetirementFilingStatus;
  magi: number | null;
  coveredByWorkplacePlan: boolean | null;
  spouseCoveredByWorkplacePlan: boolean | null;
  eligibleTaxableCompensation: number | null;
  traditionalContributed: number;
  rothContributed: number;
}): IraResult {
  const rules = getRetirementRules(input.taxYear);
  const reasons: RetirementReasonCode[] = [];

  const traditionalContributed = nonNeg(input.traditionalContributed);
  const rothContributed = nonNeg(input.rothContributed);
  const combinedContributed = traditionalContributed + rothContributed;

  const statutoryLimit = iraCombinedLimit(input.taxYear, input.age);
  const comp =
    input.eligibleTaxableCompensation == null ||
    !Number.isFinite(Number(input.eligibleTaxableCompensation))
      ? null
      : nonNeg(input.eligibleTaxableCompensation);

  // IRA contributions can never exceed eligible taxable compensation.
  let combinedLimit = statutoryLimit;
  if (comp != null && comp < statutoryLimit) {
    combinedLimit = comp;
    reasons.push("insufficient_taxable_compensation");
  }

  const remainingContributionRoom = Math.max(0, combinedLimit - combinedContributed);

  /* Traditional deductibility — contribution room ≠ deductible room. */
  const isJoint = input.filingStatus === "married_filing_jointly";
  const isSeparate = input.filingStatus === "married_filing_separately";
  const covered = input.coveredByWorkplacePlan === true;
  const spouseCovered = input.spouseCoveredByWorkplacePlan === true;

  // The amount eligible for deduction can never exceed what was contributed
  // or the compensation-capped combined limit attributable to Traditional.
  const traditionalCeiling = Math.min(traditionalContributed, combinedLimit);

  let traditionalDeductible = traditionalCeiling;
  const phaseouts = rules.traditionalIraPhaseouts;

  if (traditionalCeiling > 0) {
    let range: PhaseoutRange | null = null;
    if (isSeparate && (covered || spouseCovered)) {
      range = phaseouts.marriedFilingSeparatelyCovered;
    } else if (covered) {
      range = isJoint ? phaseouts.coveredMarriedJoint : phaseouts.coveredSingle;
    } else if (isJoint && spouseCovered) {
      range = phaseouts.uncoveredWithCoveredSpouse;
    }

    if (range) {
      if (input.magi == null || !Number.isFinite(Number(input.magi))) {
        // Cannot evaluate the phaseout without MAGI — flag instead of guessing.
        reasons.push("unknown_plan_data");
      } else {
        traditionalDeductible = prorateForPhaseout(traditionalCeiling, Number(input.magi), range);
        if (traditionalDeductible < traditionalCeiling) {
          reasons.push("traditional_ira_magi_phaseout");
        }
      }
    }
    // Neither spouse covered by a workplace plan → fully deductible.
  }

  const traditionalNondeductible = Math.max(0, traditionalContributed - traditionalDeductible);

  /* Roth direct-contribution eligibility. */
  const rothPhaseouts = rules.rothIraPhaseouts;
  const rothRange: PhaseoutRange = isJoint
    ? rothPhaseouts.marriedJoint
    : isSeparate
      ? rothPhaseouts.marriedFilingSeparately
      : rothPhaseouts.single;

  let rothAllowed = combinedLimit;
  if (input.magi == null || !Number.isFinite(Number(input.magi))) {
    if (!reasons.includes("unknown_plan_data")) reasons.push("unknown_plan_data");
  } else {
    rothAllowed = prorateForPhaseout(combinedLimit, Number(input.magi), rothRange);
    if (rothAllowed < combinedLimit) reasons.push("roth_ira_magi_phaseout");
  }
  // Traditional dollars already used consume shared IRA room.
  const rothCeiling = Math.max(0, Math.min(rothAllowed, combinedLimit - traditionalContributed));

  return {
    combinedContributed,
    combinedLimit,
    remainingContributionRoom,
    traditionalContributed,
    traditionalDeductible,
    traditionalNondeductible,
    rothContributed,
    rothAllowed,
    rothRemaining: Math.max(0, rothCeiling - rothContributed),
    eligibleTaxableCompensation: comp ?? 0,
    reasons,
  };
}

/* ──────────────────────── Self-employed earned income ───────────────────── */

/**
 * Reduced self-employed contribution rate: a nominal 25% plan rate becomes
 * 20% of net earned income (rate / (1 + rate)).
 */
export function reducedSelfEmployedRate(nominalRate: number): number {
  const r = nonNeg(nominalRate);
  return r > 0 ? r / (1 + r) : 0;
}

/**
 * Self-employed earned income = net business profit − deductible half of SE tax.
 * Employer retirement contributions never reduce the SE-tax base, so they are
 * intentionally absent here.
 */
export function selfEmployedEarnedIncome(input: {
  netBusinessProfit: number | null | undefined;
  deductibleHalfSeTax?: number | null;
}): number | null {
  if (input.netBusinessProfit == null || !Number.isFinite(Number(input.netBusinessProfit))) {
    return null;
  }
  const profit = Number(input.netBusinessProfit);
  if (profit <= 0) return 0;
  return Math.max(0, profit - nonNeg(input.deductibleHalfSeTax));
}

/* ───────────────────────────── Plan sub-engine ──────────────────────────── */

const DEFAULT_SELF_EMPLOYED_NOMINAL_RATE = 0.25;

function computePlanOpportunity(
  plan: PlanOpportunityInput,
  ctx: { taxYear: number; age: number | null },
): PlanOpportunity {
  const rules = getRetirementRules(ctx.taxYear);
  const reasons: RetirementReasonCode[] = [];
  const employeeContribution = nonNeg(plan.employeeContribution);
  const employerContribution = nonNeg(plan.employerContribution);
  const bucket = getDeferralBucket(plan.planKind);

  if (plan.requestsSpecial457Catchup && plan.planKind === "governmental_457b") {
    // Final-three-years catch-up needs plan metadata the app does not store.
    reasons.push("unknown_plan_data");
  }

  /* Eligible compensation, per entity type. */
  let eligibleCompensation: number | null = null;
  const isSelfEmployedPlan =
    plan.entityKind === "schedule_c" || plan.entityKind === "partnership_k1";

  if (plan.entityKind === "w2" || plan.entityKind === "s_corp") {
    // S-corp capacity must use W-2 wages — never distributions.
    eligibleCompensation =
      plan.w2Wages == null || !Number.isFinite(Number(plan.w2Wages))
        ? null
        : nonNeg(plan.w2Wages);
  } else if (plan.entityKind === "schedule_c") {
    eligibleCompensation = selfEmployedEarnedIncome({
      netBusinessProfit: plan.netBusinessProfit,
      deductibleHalfSeTax: plan.deductibleHalfSeTax,
    });
  } else if (plan.entityKind === "partnership_k1") {
    // Only earned income for services qualifies; passive K-1 never does.
    eligibleCompensation = selfEmployedEarnedIncome({
      netBusinessProfit: plan.k1EarnedIncomeFromServices,
      deductibleHalfSeTax: plan.deductibleHalfSeTax,
    });
  }

  if (eligibleCompensation != null) {
    eligibleCompensation = Math.min(eligibleCompensation, rules.compensationCap);
  }

  /* §415(c) ceiling — catch-up dollars sit outside annual additions. */
  const baseEmployeeLimit =
    bucket === "governmental_457b"
      ? rules.governmental457b.limit
      : bucket === "simple"
        ? rules.simple.limit
        : rules.employeeDeferral;

  const employeeTowardAdditions = Math.min(employeeContribution, baseEmployeeLimit);
  const totalAdditions = employeeContribution + employerContribution;
  const additionsUsed = employeeTowardAdditions + employerContribution;

  let annualAdditionsLimit: number | null = rules.annualAdditions;
  if (eligibleCompensation != null && eligibleCompensation < rules.annualAdditions) {
    annualAdditionsLimit = eligibleCompensation;
    reasons.push("compensation_limit");
  } else if (eligibleCompensation == null) {
    annualAdditionsLimit = rules.annualAdditions;
  } else {
    reasons.push("plan_415c_limit");
  }

  /* Employer capacity. */
  let employerCapacityRemaining: number | null = null;
  const nominalRate =
    plan.employerContributionRate == null || !Number.isFinite(Number(plan.employerContributionRate))
      ? null
      : nonNeg(plan.employerContributionRate);

  if (plan.planKind === "governmental_457b") {
    // Governmental 457(b) has no separate employer profit-sharing capacity here.
    employerCapacityRemaining = null;
    if (!reasons.includes("unknown_plan_data")) reasons.push("unknown_plan_data");
  } else if (isSelfEmployedPlan) {
    if (eligibleCompensation == null) {
      reasons.push("unknown_plan_data");
    } else {
      const rate = reducedSelfEmployedRate(nominalRate ?? DEFAULT_SELF_EMPLOYED_NOMINAL_RATE);
      const formulaCapacity = eligibleCompensation * rate;
      const additionsCeiling = Math.max(0, (annualAdditionsLimit ?? 0) - additionsUsed);
      employerCapacityRemaining = Math.max(
        0,
        Math.min(formulaCapacity - employerContribution, additionsCeiling),
      );
      reasons.push("self_employed_employer_formula");
    }
  } else if (plan.entityKind === "s_corp") {
    if (eligibleCompensation == null || nominalRate == null) {
      reasons.push("unknown_plan_data");
    } else {
      const formulaCapacity = eligibleCompensation * nominalRate;
      const additionsCeiling = Math.max(0, (annualAdditionsLimit ?? 0) - additionsUsed);
      employerCapacityRemaining = Math.max(
        0,
        Math.min(formulaCapacity - employerContribution, additionsCeiling),
      );
    }
  } else {
    // W-2 and unknown entities: never assume the employer will fill §415(c).
    if (plan.employerFormulaKnown && nominalRate != null && eligibleCompensation != null) {
      const additionsCeiling = Math.max(0, (annualAdditionsLimit ?? 0) - additionsUsed);
      employerCapacityRemaining = Math.max(
        0,
        Math.min(eligibleCompensation * nominalRate - employerContribution, additionsCeiling),
      );
    } else {
      reasons.push("unknown_plan_data");
    }
  }

  if (bucket === "402g") reasons.push("employee_402g_limit");
  if (bucket === "governmental_457b") reasons.push("governmental_457b_limit");
  if (bucket === "simple") reasons.push("simple_plan_limit");

  return {
    planId: plan.planId ?? null,
    companyId: plan.companyId ?? null,
    companyName: plan.companyName || "Plan",
    planKind: plan.planKind,
    entityKind: plan.entityKind,
    deferralBucket: bucket,
    employeeContribution,
    employerContribution,
    totalAdditions,
    annualAdditionsLimit,
    employerCapacityRemaining,
    eligibleCompensation,
    reasons: Array.from(new Set(reasons)),
  };
}

/* ────────────────────────────── Main entry ──────────────────────────────── */

export function computeRetirementOpportunity(
  input: RetirementOpportunityInput,
): RetirementOpportunityResult {
  const taxYear = Number(input.taxYear) || LATEST_RULE_YEAR;
  const rules = getRetirementRules(taxYear);
  const age = input.dateOfBirth
    ? ageAttainedInYear(input.dateOfBirth, taxYear)
    : input.age == null
      ? null
      : Number(input.age);

  const planInputs = input.plans ?? [];
  const plans = planInputs.map((p) => computePlanOpportunity(p, { taxYear, age }));

  const sumBucket = (bucket: DeferralBucket) =>
    plans.filter((p) => p.deferralBucket === bucket).reduce((s, p) => s + p.employeeContribution, 0);

  /* §402(g): ONE shared bucket across every employer and Solo 401(k). */
  const catchUp402g = catchUpFor(rules, age);
  const contributed402g = sumBucket("402g");
  const simpleExists = plans.some((p) => p.deferralBucket === "simple");
  const simpleContributed = sumBucket("simple");
  const simpleCatchUp = catchUpFor(rules.simple, age);

  const employee402g: DeferralBucketResult = {
    contributed: contributed402g,
    limit: rules.employeeDeferral + catchUp402g,
    remaining: Math.max(0, rules.employeeDeferral + catchUp402g - contributed402g - simpleContributed),
    catchUp: catchUp402g,
    reasons: ["employee_402g_limit"],
  };

  const has457 = plans.some((p) => p.deferralBucket === "governmental_457b");
  const contributed457 = sumBucket("governmental_457b");
  const catchUp457 = catchUpFor(rules.governmental457b, age);
  const governmental457b: DeferralBucketResult | undefined = has457
    ? {
        contributed: contributed457,
        limit: rules.governmental457b.limit + catchUp457,
        remaining: Math.max(0, rules.governmental457b.limit + catchUp457 - contributed457),
        catchUp: catchUp457,
        reasons: ["governmental_457b_limit"],
      }
    : undefined;

  const simple: DeferralBucketResult | undefined = simpleExists
    ? {
        contributed: simpleContributed,
        limit: rules.simple.limit + simpleCatchUp,
        remaining: Math.max(0, rules.simple.limit + simpleCatchUp - simpleContributed),
        catchUp: simpleCatchUp,
        reasons: ["simple_plan_limit"],
      }
    : undefined;

  const ira = computeIraOpportunity({
    taxYear,
    age,
    filingStatus: input.filingStatus || "single",
    magi: input.magi ?? null,
    coveredByWorkplacePlan:
      input.coveredByWorkplacePlan ?? (planInputs.length > 0 ? true : null),
    spouseCoveredByWorkplacePlan: input.spouseCoveredByWorkplacePlan ?? null,
    eligibleTaxableCompensation: input.eligibleTaxableCompensation ?? null,
    traditionalContributed: nonNeg(input.ira?.traditionalContributed),
    rothContributed: nonNeg(input.ira?.rothContributed),
  });

  /* Explicit tax routing categories — never one overloaded retirement value. */
  const employeePreTaxDeduction = plans.reduce((s, p) => s + p.employeeContribution, 0);
  const selfEmployedEmployerDeduction = plans
    .filter((p) => SELF_EMPLOYED_ENTITIES.includes(p.entityKind))
    .reduce((s, p) => s + p.employerContribution, 0);
  const w2EmployerExcluded = plans
    .filter((p) => p.entityKind === "w2" || p.entityKind === "s_corp" || p.entityKind === "unknown")
    .reduce((s, p) => s + p.employerContribution, 0);

  return {
    taxYear,
    employee402g,
    ...(governmental457b ? { governmental457b } : {}),
    ...(simple ? { simple } : {}),
    ira,
    plans,
    taxRouting: {
      employeePreTaxDeduction,
      traditionalIraDeduction: ira.traditionalDeductible,
      selfEmployedEmployerDeduction,
      w2EmployerExcluded,
      rothDeduction: 0,
    },
  };
}

/* ────────────────── Projected year-end business profit ──────────────────── */

/**
 * Canonical projected net business profit for retirement capacity.
 * Never `YTD profit + remaining gross revenue`: remaining planned expenses are
 * subtracted so the projection stays a PROFIT figure.
 */
export function projectedNetBusinessProfit(input: {
  actualYtdNetProfit: number;
  remainingPlannedGrossIncome?: number | null;
  remainingPlannedExpenses?: number | null;
}): number {
  const actual = Number(input.actualYtdNetProfit) || 0;
  return (
    actual + nonNeg(input.remainingPlannedGrossIncome) - nonNeg(input.remainingPlannedExpenses)
  );
}

/* ───────────────── Recurring contribution occurrence counting ───────────── */

export type ContributionPayFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "quarterly"
  | "annually";

export const PERIODS_PER_YEAR: Record<ContributionPayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

/** Documented fallback used only when the company pay schedule is unknown. */
export const FALLBACK_PAY_FREQUENCY: ContributionPayFrequency = "biweekly";

export function normalizePayFrequency(
  value: string | null | undefined,
): ContributionPayFrequency | null {
  const v = String(value || "").toLowerCase().replace(/[\s-]/g, "_");
  switch (v) {
    case "weekly":
      return "weekly";
    case "biweekly":
    case "bi_weekly":
    case "every_two_weeks":
      return "biweekly";
    case "semimonthly":
    case "semi_monthly":
    case "twice_monthly":
      return "semimonthly";
    case "monthly":
      return "monthly";
    case "quarterly":
      return "quarterly";
    case "annually":
    case "yearly":
    case "annual":
      return "annually";
    default:
      return null;
  }
}

const parseISO = (d: string | null | undefined): Date | null => {
  if (!d) return null;
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Number of recurring contribution occurrences inside `taxYear`, honouring the
 * schedule's pay frequency, start date and end date. Partial-year schedules
 * produce partial counts — never a blind 26.
 */
export function countContributionOccurrences(input: {
  taxYear: number;
  payFrequency: ContributionPayFrequency;
  startDate?: string | null;
  endDate?: string | null;
}): number {
  const yearStart = new Date(input.taxYear, 0, 1);
  const yearEnd = new Date(input.taxYear, 11, 31);
  const start = parseISO(input.startDate) ?? yearStart;
  const end = parseISO(input.endDate) ?? yearEnd;
  if (end < yearStart || start > yearEnd) return 0;

  const windowStart = start > yearStart ? start : yearStart;
  const windowEnd = end < yearEnd ? end : yearEnd;

  const freq = input.payFrequency;
  let count = 0;

  if (freq === "semimonthly") {
    // Twice-monthly cadence: the 15th and the last day of each month.
    for (let month = 0; month < 12; month++) {
      const lastDay = new Date(input.taxYear, month + 1, 0).getDate();
      for (const day of [15, lastDay]) {
        const d = new Date(input.taxYear, month, day);
        if (d >= windowStart && d <= windowEnd && d >= start && d <= end) count++;
      }
    }
    return count;
  }

  const cursor = new Date(start);
  // Walk the schedule from its own start date so alignment is preserved.
  for (let i = 0; i < 400; i++) {
    if (cursor > windowEnd) break;
    if (cursor >= windowStart) count++;
    if (freq === "weekly") cursor.setDate(cursor.getDate() + 7);
    else if (freq === "biweekly") cursor.setDate(cursor.getDate() + 14);
    else if (freq === "monthly") cursor.setMonth(cursor.getMonth() + 1);
    else if (freq === "quarterly") cursor.setMonth(cursor.getMonth() + 3);
    else cursor.setFullYear(cursor.getFullYear() + 1);
  }
  return count;
}

export interface AnnualizedContributionResult {
  annual: number;
  perPeriod: number;
  occurrences: number;
  payFrequency: ContributionPayFrequency | null;
  usedFallback: boolean;
}

/**
 * Annualize a contribution row for a tax year.
 * One-time contributions stay exact; recurring contributions use the real
 * schedule when known and a documented fallback otherwise.
 */
export function annualizeRetirementContribution(input: {
  amount: number | string;
  frequency: string;
  taxYear: number;
  payFrequency?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  contributionDate?: string | null;
}): AnnualizedContributionResult {
  const amount = Number(input.amount) || 0;
  const taxYear = Number(input.taxYear);

  if (input.frequency === "one_time") {
    const d = input.contributionDate || input.startDate;
    const inYear = d ? Number(String(d).slice(0, 4)) === taxYear : true;
    return {
      annual: inYear ? amount : 0,
      perPeriod: 0,
      occurrences: inYear ? 1 : 0,
      payFrequency: null,
      usedFallback: false,
    };
  }

  if (input.frequency === "yearly") {
    const occurrences = countContributionOccurrences({
      taxYear,
      payFrequency: "annually",
      startDate: input.startDate,
      endDate: input.endDate,
    });
    return { annual: amount * occurrences, perPeriod: amount, occurrences, payFrequency: "annually", usedFallback: false };
  }

  if (input.frequency === "monthly") {
    const occurrences = countContributionOccurrences({
      taxYear,
      payFrequency: "monthly",
      startDate: input.startDate,
      endDate: input.endDate,
    });
    return { annual: amount * occurrences, perPeriod: amount, occurrences, payFrequency: "monthly", usedFallback: false };
  }

  // per_paycheck (and anything unrecognized): follow the company pay schedule.
  const resolved = normalizePayFrequency(input.payFrequency);
  const payFrequency = resolved ?? FALLBACK_PAY_FREQUENCY;
  const occurrences = countContributionOccurrences({
    taxYear,
    payFrequency,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  return {
    annual: amount * occurrences,
    perPeriod: amount,
    occurrences,
    payFrequency,
    usedFallback: resolved == null,
  };
}

export const __internals = { toISO, parseISO };
