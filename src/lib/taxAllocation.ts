/**
 * Canonical Annual Tax Allocation Layer
 * ==========================================================================
 * ONE authoritative answer to: "the annual tax engine says the household owes
 * $X — how much of that $X is each income source responsible for funding, and
 * how much of that responsibility is still uncovered?"
 *
 * Core product principle
 * ----------------------
 *   All income determines the tax RATE together.
 *   Each income source funds its appropriate SHARE of the resulting liability.
 *
 * This module therefore does NOT calculate tax. It consumes a `TaxEstimate`
 * produced by `calculateFullEstimate` (src/lib/taxEngine.ts) — the single
 * authoritative progressive-bracket engine — and allocates the already-computed
 * liability across sources. That ordering matters:
 *
 *   ✅ tax first, then derive the allocation rate from the calculated tax
 *   ⛔ never "guess an ETR × income" as a substitute for the bracket math
 *   ⛔ never apply the household's highest MARGINAL bracket to every dollar
 *
 * Isolation rules (see `Invariant F` in the tests):
 *   - Self-employment tax is allocated ONLY to SE-taxable bases.
 *   - Business state tax (B&O / franchise / gross receipts) is allocated ONLY
 *     to the business source that generates it — it never inflates a W-2 rate.
 *   - Personal state income tax is exactly $0 when the setting is disabled.
 *   - Preferential income (LTCG / qualified dividends) keeps its preferential
 *     tax slice and never inherits the ordinary-income allocation rate.
 *   - Employee FICA is never treated as federal income-tax withholding, and
 *     never credited against the income-tax target.
 */

import type { TaxEstimate } from "@/lib/taxEngine";
import { SE_INCOME_FACTOR } from "@/lib/taxEngine";

export type AllocationSourceType =
  | "w2"
  | "1099"
  | "k1"
  | "scorp_w2"
  | "investment"
  | "other";

export interface AllocationSourceInput {
  /** Stable id — company id, employer key, or synthetic bucket key. */
  sourceId: string;
  sourceLabel?: string;
  sourceType: AllocationSourceType;
  /** Projected annual gross for this source (actual YTD + remaining planned). */
  projectedAnnualIncome: number;
  /**
   * Ordinary-income tax base attributable to this source, after the source's
   * own pre-tax deductions / business expenses. Drives the share of the
   * household federal ordinary-income liability this source funds.
   */
  allocableOrdinaryTaxBase: number;
  /** LTCG + qualified-dividend base attributable to this source. */
  allocablePreferentialTaxBase?: number;
  /** Net SE income (BEFORE the 92.35% factor). 0 / omitted when not SE-taxable. */
  selfEmploymentBase?: number;
  /** Base subject to PERSONAL state income tax. Ignored when the tax is $0. */
  personalStateTaxBase?: number;
  /** Base subject to BUSINESS state tax (B&O etc). Ignored when the tax is $0. */
  businessStateTaxBase?: number;
  /**
   * Taxes ACTUALLY paid/withheld YTD that count against the income-tax target
   * for this source (federal income tax withheld, state withholding when state
   * tax is in the target, estimated payments attributed to this source).
   * MUST exclude employee Social Security / Medicare.
   */
  paidOrWithheldYtd?: number;
  /** Expected withholding from this source's REMAINING future events. */
  expectedFutureCoverage?: number;
  /** Money reserved/saved for taxes but not yet paid to the government. */
  savedReservesYtd?: number;
}

export interface AllocatedSource {
  sourceId: string;
  sourceLabel: string;
  sourceType: AllocationSourceType;
  projectedAnnualIncome: number;
  allocableTaxableIncome: number;

  allocatedFederalIncomeTax: number;
  allocatedPersonalStateTax: number;
  allocatedSelfEmploymentTax: number;
  allocatedBusinessStateTax: number;
  allocatedInvestmentTax: number;

  totalAllocatedTaxResponsibility: number;

  /** Actually paid/withheld (never includes reserves). */
  paidOrWithheldYtd: number;
  /** Expected future withholding from remaining events. */
  expectedFutureCoverage: number;
  /** Reserved but NOT yet paid. Reduces what we still ask the user to save. */
  savedReservesYtd: number;

  /**
   * Still unfunded after paid + expected future withholding + reserves.
   * Floored at 0.
   */
  remainingSourceTaxNeed: number;
  /** Signed version of the above (negative = over-funded). */
  signedSourceTaxNeed: number;
}

export interface AnnualTaxAllocation {
  /** = estimate.totalTaxLiability. The recommendation layer never invents more. */
  projectedTaxLiability: number;

  federalOrdinaryIncomeTax: number;
  investmentTax: number;
  selfEmploymentTax: number;
  personalStateTax: number;
  businessStateTax: number;
  otherTax: number;

  sources: AllocatedSource[];

  totalAllocatedTax: number;
  /** projectedTaxLiability − totalAllocatedTax. Rounding only. */
  reconciliationDifference: number;

  /**
   * Allocation rate (fraction, not percent) derived FROM the calculated
   * federal ordinary-income liability:
   *   federalOrdinaryIncomeTax ÷ combined allocable ordinary tax base
   * Use this to give a future income event its fair share. It is a way to
   * allocate an already-calculated liability, never a replacement for the
   * progressive calculation.
   */
  federalOrdinaryAllocationRate: number;
  /** personalStateTax ÷ combined personal-state base (0 when disabled). */
  personalStateAllocationRate: number;
  /** investmentTax ÷ combined preferential base. */
  preferentialAllocationRate: number;
  /** Combined allocable ordinary tax base used as the denominator above. */
  combinedOrdinaryTaxBase: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pos = (v: unknown) => Math.max(0, num(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pro-rata split of `total` across `weights`, with the rounding residual
 *  pushed onto the largest weight so the parts always sum back to `total`. */
function proRata(total: number, weights: number[]): number[] {
  const out = weights.map(() => 0);
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total === 0 || sum <= 0) return out;
  let allocated = 0;
  let largestIdx = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (Math.max(0, weights[i]) > Math.max(0, weights[largestIdx])) largestIdx = i;
  }
  for (let i = 0; i < weights.length; i += 1) {
    const w = Math.max(0, weights[i]);
    if (w <= 0) continue;
    const part = round2((total * w) / sum);
    out[i] = part;
    allocated = round2(allocated + part);
  }
  const residual = round2(total - allocated);
  if (residual !== 0) out[largestIdx] = round2(out[largestIdx] + residual);
  return out;
}

/**
 * Build the canonical allocation from an annual estimate.
 *
 * `estimate` MUST come from the annual tax engine. Every dollar allocated here
 * originates from that estimate — the allocation layer never adds liability.
 */
export function buildAnnualTaxAllocation(input: {
  estimate: TaxEstimate | null | undefined;
  sources: AllocationSourceInput[];
}): AnnualTaxAllocation {
  const est = input.estimate;
  const sources = input.sources ?? [];

  const federalTax = pos(est?.federalTax);
  const beforeCredits = pos(est?.federalTaxBeforeCredits);
  const ordinaryBefore = pos(est?.ordinaryFederalTaxBeforeCredits);
  const preferentialBefore = pos(est?.preferentialFederalTaxBeforeCredits);

  // Dependent credits reduce the ordinary and preferential slices
  // proportionally so the two post-credit slices still sum to federalTax.
  let federalOrdinaryIncomeTax: number;
  let investmentTax: number;
  if (beforeCredits > 0 && (ordinaryBefore > 0 || preferentialBefore > 0)) {
    const ordinaryShare = ordinaryBefore / (ordinaryBefore + preferentialBefore);
    federalOrdinaryIncomeTax = round2(federalTax * ordinaryShare);
    investmentTax = round2(federalTax - federalOrdinaryIncomeTax);
  } else {
    federalOrdinaryIncomeTax = round2(federalTax);
    investmentTax = 0;
  }

  const selfEmploymentTax = pos(est?.seTax?.total);
  const personalStateTax = pos(est?.personalStateTax);
  const businessStateTax = pos(est?.businessStateTax);
  const projectedTaxLiability = round2(pos(est?.totalTaxLiability));

  const ordinaryWeights = sources.map((s) => pos(s.allocableOrdinaryTaxBase));
  const preferentialWeights = sources.map((s) => pos(s.allocablePreferentialTaxBase));
  // SE tax follows the 92.35% SE base so a source's share matches how the
  // engine actually computed the tax.
  const seWeights = sources.map((s) => pos(s.selfEmploymentBase) * SE_INCOME_FACTOR);
  const personalStateWeights = sources.map((s) =>
    pos(s.personalStateTaxBase ?? s.allocableOrdinaryTaxBase),
  );
  const businessStateWeights = sources.map((s) => pos(s.businessStateTaxBase));

  const fedParts = proRata(federalOrdinaryIncomeTax, ordinaryWeights);
  const prefParts = proRata(investmentTax, preferentialWeights);
  const seParts = proRata(selfEmploymentTax, seWeights);
  const personalStateParts = proRata(personalStateTax, personalStateWeights);
  const businessStateParts = proRata(businessStateTax, businessStateWeights);

  const allocated: AllocatedSource[] = sources.map((s, i) => {
    const allocatedFederalIncomeTax = fedParts[i];
    const allocatedInvestmentTax = prefParts[i];
    const allocatedSelfEmploymentTax = seParts[i];
    const allocatedPersonalStateTax = personalStateParts[i];
    const allocatedBusinessStateTax = businessStateParts[i];

    const totalAllocatedTaxResponsibility = round2(
      allocatedFederalIncomeTax +
        allocatedInvestmentTax +
        allocatedSelfEmploymentTax +
        allocatedPersonalStateTax +
        allocatedBusinessStateTax,
    );

    const paidOrWithheldYtd = round2(pos(s.paidOrWithheldYtd));
    const expectedFutureCoverage = round2(pos(s.expectedFutureCoverage));
    const savedReservesYtd = round2(pos(s.savedReservesYtd));
    const signedSourceTaxNeed = round2(
      totalAllocatedTaxResponsibility -
        paidOrWithheldYtd -
        expectedFutureCoverage -
        savedReservesYtd,
    );

    return {
      sourceId: s.sourceId,
      sourceLabel: s.sourceLabel ?? s.sourceId,
      sourceType: s.sourceType,
      projectedAnnualIncome: round2(pos(s.projectedAnnualIncome)),
      allocableTaxableIncome: round2(pos(s.allocableOrdinaryTaxBase) + pos(s.allocablePreferentialTaxBase)),
      allocatedFederalIncomeTax,
      allocatedPersonalStateTax,
      allocatedSelfEmploymentTax,
      allocatedBusinessStateTax,
      allocatedInvestmentTax,
      totalAllocatedTaxResponsibility,
      paidOrWithheldYtd,
      expectedFutureCoverage,
      savedReservesYtd,
      remainingSourceTaxNeed: Math.max(0, signedSourceTaxNeed),
      signedSourceTaxNeed,
    };
  });

  const totalAllocatedTax = round2(
    allocated.reduce((a, s) => a + s.totalAllocatedTaxResponsibility, 0),
  );

  // Any part of the annual liability that no source could carry (e.g. all
  // weights are zero) is reported rather than silently redistributed.
  const allocatableTotal = round2(
    federalOrdinaryIncomeTax +
      investmentTax +
      selfEmploymentTax +
      personalStateTax +
      businessStateTax,
  );
  const otherTax = round2(projectedTaxLiability - allocatableTotal);

  const combinedOrdinaryTaxBase = round2(ordinaryWeights.reduce((a, w) => a + w, 0));
  const combinedPreferentialBase = preferentialWeights.reduce((a, w) => a + w, 0);
  const combinedPersonalStateBase = personalStateWeights.reduce((a, w) => a + w, 0);

  return {
    projectedTaxLiability,
    federalOrdinaryIncomeTax,
    investmentTax,
    selfEmploymentTax,
    personalStateTax,
    businessStateTax,
    otherTax,
    sources: allocated,
    totalAllocatedTax,
    reconciliationDifference: round2(allocatableTotal - totalAllocatedTax),
    federalOrdinaryAllocationRate:
      combinedOrdinaryTaxBase > 0 ? federalOrdinaryIncomeTax / combinedOrdinaryTaxBase : 0,
    personalStateAllocationRate:
      combinedPersonalStateBase > 0 ? personalStateTax / combinedPersonalStateBase : 0,
    preferentialAllocationRate:
      combinedPreferentialBase > 0 ? investmentTax / combinedPreferentialBase : 0,
    combinedOrdinaryTaxBase,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Per-event target: what share of the ALREADY-CALCULATED annual liability
// does this single income event carry?
// ──────────────────────────────────────────────────────────────────────────

export interface EventTaxTargetInput {
  allocation: AnnualTaxAllocation;
  sourceType: AllocationSourceType;
  /** Ordinary taxable base for this one event (gross − its pre-tax deductions). */
  ordinaryTaxBase: number;
  /** Preferential base for this event (LTCG / qualified dividends). */
  preferentialTaxBase?: number;
  /** Net SE income for this event, before the 92.35% factor. */
  selfEmploymentBase?: number;
  /** Marginal SE rate as a FRACTION of the SE base (e.g. 0.1413). */
  selfEmploymentRate?: number;
  /** Business state tax rate as a FRACTION, applied to `businessStateTaxBase`. */
  businessStateTaxRate?: number;
  businessStateTaxBase?: number;
}

export interface EventTaxTarget {
  federalIncomeTax: number;
  personalStateTax: number;
  selfEmploymentTax: number;
  businessStateTax: number;
  investmentTax: number;
  /** Total tax this event is responsible for funding. */
  total: number;
  /** Blended rate as a PERCENT of the event's ordinary base (display only). */
  effectiveRatePct: number;
}

const W2_TYPES: ReadonlySet<AllocationSourceType> = new Set(["w2", "scorp_w2"]);

/**
 * Compute an event's tax responsibility from the canonical allocation.
 *
 * Source-specific taxes are applied ONLY where they belong:
 *   - W-2 events get federal ordinary + personal state. Never SE, never
 *     business state tax.
 *   - Business events add SE tax and business state tax when applicable.
 *   - Investment events use the preferential allocation rate.
 */
export function computeEventTaxTarget(input: EventTaxTargetInput): EventTaxTarget {
  const { allocation, sourceType } = input;
  const ordinaryBase = pos(input.ordinaryTaxBase);
  const preferentialBase = pos(input.preferentialTaxBase);
  const isW2 = W2_TYPES.has(sourceType);
  const isInvestment = sourceType === "investment";

  const federalIncomeTax = round2(ordinaryBase * allocation.federalOrdinaryAllocationRate);
  const personalStateTax = round2(ordinaryBase * allocation.personalStateAllocationRate);
  const investmentTax = round2(preferentialBase * allocation.preferentialAllocationRate);

  const selfEmploymentTax =
    isW2 || isInvestment
      ? 0
      : round2(pos(input.selfEmploymentBase) * Math.max(0, num(input.selfEmploymentRate)));
  const businessStateTax =
    isW2 || isInvestment
      ? 0
      : round2(
          pos(input.businessStateTaxBase ?? input.ordinaryTaxBase) *
            Math.max(0, num(input.businessStateTaxRate)),
        );

  const total = round2(
    federalIncomeTax + personalStateTax + selfEmploymentTax + businessStateTax + investmentTax,
  );
  const rateBase = ordinaryBase + preferentialBase;

  return {
    federalIncomeTax,
    personalStateTax,
    selfEmploymentTax,
    businessStateTax,
    investmentTax,
    total,
    effectiveRatePct: rateBase > 0 ? round2((total / rateBase) * 100) : 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// W-2 funding plan: SAME responsibility, two delivery mechanisms.
// ──────────────────────────────────────────────────────────────────────────

export type W2FundingMethod = "annual_w4" | "paycheck_target";

export interface W2FundingPlanInput {
  /** Allocated ANNUAL tax responsibility for this W-2 source. */
  allocatedAnnualResponsibility: number;
  /** Federal income tax withheld YTD (never FICA). */
  actualFederalWithheldYtd: number;
  /** State withholding YTD — pass 0 when state tax isn't in the target. */
  actualStateWithheldYtd?: number;
  /** Baseline withholding expected from remaining paychecks with NO change. */
  expectedFutureBaselineWithholding: number;
  /** Estimated payments / other credits attributed to this W-2 source. */
  otherCreditsApplied?: number;
  /** Reserves already saved (not paid) for this source. */
  savedReservesYtd?: number;
  /** Future W-2 paychecks available to carry the adjustment. */
  remainingPaychecks: number;
  method: W2FundingMethod;
  /**
   * Extra withholding the user has ALREADY achieved per paycheck via a prior
   * W-4 change (actual − baseline). Coverage we can count on going forward.
   */
  achievedExtraPerPaycheck?: number;
}

export interface W2FundingPlan {
  method: W2FundingMethod;
  allocatedAnnualResponsibility: number;
  totalCoverage: number;
  /** Remaining annual W-2 deficit after all coverage. Floored at 0. */
  remainingDeficit: number;
  signedDeficit: number;
  remainingPaychecks: number;
  /** Recommended ADDITIONAL federal withholding per future paycheck (W-4 4c). */
  additionalWithholdingPerPaycheck: number;
  /**
   * Separate savings recommended per future paycheck. Zero under annual_w4
   * whenever the W-4 adjustment can fund the whole deficit — the two are
   * delivery mechanisms for the SAME liability and must never double-fund.
   */
  savingsPerPaycheck: number;
  /** Deficit the recommended W-4 adjustment is expected to fund. */
  fundedByW4: number;
  /** Deficit that W-4 cannot fund (e.g. no remaining paychecks). */
  unfundedByW4: number;
  isOnTrack: boolean;
}

export function computeW2FundingPlan(input: W2FundingPlanInput): W2FundingPlan {
  const responsibility = round2(pos(input.allocatedAnnualResponsibility));
  const remainingPaychecks = Math.max(0, Math.floor(num(input.remainingPaychecks)));
  const achievedExtra = pos(input.achievedExtraPerPaycheck);

  const totalCoverage = round2(
    pos(input.actualFederalWithheldYtd) +
      pos(input.actualStateWithheldYtd) +
      pos(input.expectedFutureBaselineWithholding) +
      pos(input.otherCreditsApplied) +
      pos(input.savedReservesYtd) +
      achievedExtra * remainingPaychecks,
  );

  const signedDeficit = round2(responsibility - totalCoverage);
  const remainingDeficit = Math.max(0, signedDeficit);

  if (input.method === "annual_w4") {
    const fundedByW4 = remainingPaychecks > 0 ? remainingDeficit : 0;
    const unfundedByW4 = round2(remainingDeficit - fundedByW4);
    return {
      method: "annual_w4",
      allocatedAnnualResponsibility: responsibility,
      totalCoverage,
      remainingDeficit,
      signedDeficit,
      remainingPaychecks,
      additionalWithholdingPerPaycheck:
        remainingPaychecks > 0 ? round2(fundedByW4 / remainingPaychecks) : 0,
      // Only what the W-4 adjustment genuinely cannot deliver.
      savingsPerPaycheck: 0,
      fundedByW4,
      unfundedByW4,
      isOnTrack: remainingDeficit <= 0,
    };
  }

  const opportunities = Math.max(1, remainingPaychecks);
  return {
    method: "paycheck_target",
    allocatedAnnualResponsibility: responsibility,
    totalCoverage,
    remainingDeficit,
    signedDeficit,
    remainingPaychecks,
    additionalWithholdingPerPaycheck: 0,
    savingsPerPaycheck: round2(remainingDeficit / opportunities),
    fundedByW4: 0,
    unfundedByW4: remainingDeficit,
    isOnTrack: remainingDeficit <= 0,
  };
}
