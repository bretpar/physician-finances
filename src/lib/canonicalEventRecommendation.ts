/**
 * Canonical per-event recommendation layer
 * ==========================================================================
 * ONE place where a user-facing "how much should this income event set aside /
 * withhold?" number is produced. Every recommendation surface (Personal Income,
 * Business Activity, the post-save RecommendationModal, incomeRecommendation
 * surface helpers) routes through this module so no screen can invent a
 * competing tax target.
 *
 * Pipeline (never reordered):
 *
 *   complete projected annual income
 *     → annual tax engine (`calculateFullEstimate`)      ← authority for tax law
 *     → canonical annual allocation (`buildAnnualTaxAllocation`)
 *     → source responsibility
 *     → THIS event's share (`computeEventTaxTarget`)
 *     → subtract coverage already credited to this event
 *     → optional prospective catch-up (clamped to the remaining liability)
 *
 * Isolation invariants preserved here:
 *   - SE tax only on self-employment bases (never W-2, never investments).
 *   - Business state tax (B&O) stays attached to the responsible business.
 *   - Personal state tax is exactly $0 when the setting is disabled, and is
 *     never applied to business profit (the engine excludes it from the
 *     personal state base).
 *   - Preferential income keeps the preferential allocation rate.
 *   - Employee FICA is never credited against the income-tax target.
 *   - Catch-up can never exceed the remaining annual liability, so quarterly
 *     acceleration redistributes the SAME obligation instead of adding a
 *     second one.
 *   - Historical events never receive catch-up (`isFutureOpportunity: false`).
 */

import type { TaxEstimate } from "@/lib/taxEngine";
import { isW2FilingType, normalizeFilingType } from "@/lib/filingTypes";
import {
  buildAnnualTaxAllocation,
  computeEventTaxTarget,
  type AllocationSourceInput,
  type AllocationSourceType,
  type AnnualTaxAllocation,
  type EventTaxTarget,
} from "@/lib/taxAllocation";
import {
  getBusinessStateRateForEntry,
  getMarginalSelfEmploymentRateFraction,
  getSavingsRateForIncomeBucket,
  getSelectedWithholdingProfileRate,
  type SavingsRateResult,
  type SavingsRateSettingsLike,
} from "@/lib/savingsRateSelection";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pos = (v: unknown) => Math.max(0, num(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Synthetic source ids used by the annual allocation buckets. */
export const ALLOCATION_BUCKETS = {
  w2: "bucket:w2",
  business: "bucket:business",
  investment: "bucket:investment",
  other: "bucket:other",
} as const;

/**
 * Build the canonical annual allocation directly from an annual `TaxEstimate`.
 *
 * The buckets below exist purely to split the ALREADY-CALCULATED liability;
 * they never change any tax amount. Because the allocation rates are
 * (calculated tax ÷ combined base), bucket granularity does not affect the
 * per-event rate — only the correctness of the bases does.
 */
export function buildAllocationFromEstimate(
  estimate: TaxEstimate | null | undefined,
): AnnualTaxAllocation {
  const w2Base = pos(estimate?.w2TaxableIncomeBase ?? estimate?.w2Income);
  const businessOrdinaryBase = pos(estimate?.netBusinessProfit);
  const seBase = pos(estimate?.seIncome);
  const preferentialBase = pos(estimate?.preferentialTaxableIncome);
  const otherOrdinaryBase = Math.max(0, pos(estimate?.otherIncome) - preferentialBase);

  const sources: AllocationSourceInput[] = [
    {
      sourceId: ALLOCATION_BUCKETS.w2,
      sourceLabel: "W-2 wages",
      sourceType: "w2",
      projectedAnnualIncome: pos(estimate?.w2Income),
      allocableOrdinaryTaxBase: w2Base,
      // W-2 wages are the personal state tax base; business profit is not.
      personalStateTaxBase: w2Base,
    },
    {
      sourceId: ALLOCATION_BUCKETS.business,
      sourceLabel: "Business income",
      sourceType: "1099",
      projectedAnnualIncome: pos(estimate?.grossBusinessIncome),
      allocableOrdinaryTaxBase: businessOrdinaryBase,
      selfEmploymentBase: seBase,
      // Business state tax (B&O) belongs only to the business source.
      businessStateTaxBase: businessOrdinaryBase || pos(estimate?.grossBusinessIncome),
      personalStateTaxBase: 0,
    },
    {
      sourceId: ALLOCATION_BUCKETS.investment,
      sourceLabel: "Investments",
      sourceType: "investment",
      projectedAnnualIncome: preferentialBase,
      allocableOrdinaryTaxBase: 0,
      allocablePreferentialTaxBase: preferentialBase,
      personalStateTaxBase: preferentialBase,
    },
    {
      sourceId: ALLOCATION_BUCKETS.other,
      sourceLabel: "Other income",
      sourceType: "other",
      projectedAnnualIncome: otherOrdinaryBase,
      allocableOrdinaryTaxBase: otherOrdinaryBase,
      personalStateTaxBase: otherOrdinaryBase,
    },
  ];

  return buildAnnualTaxAllocation({ estimate, sources });
}

export type EventFundingMethod = "annual_w4" | "paycheck_target";

export interface CanonicalEventRecommendationInput {
  /** The annual estimate selected by the user's withholding method. */
  estimate: TaxEstimate | null | undefined;
  /** Pre-built allocation (optional — derived from `estimate` when omitted). */
  allocation?: AnnualTaxAllocation | null;
  taxSettings: SavingsRateSettingsLike | null | undefined;

  /** UI income type ('w2' | '1099' | 'K1' | 'paycheck' | ...). */
  incomeType: string;
  incomeBucket?: "personal" | "business";

  grossIncome: number;
  retirement401k?: number;
  preTaxDeductions?: number;

  companyId?: string | null;
  applyBusinessStateTax?: boolean | null;
  includeSETaxInRecommendation?: boolean | null;
  isSelfEmploymentTaxable?: boolean | null;
  filingStatus?: "single" | "married_filing_jointly" | null;

  /** Preferential (LTCG / qualified dividend) portion of this event. */
  preferentialAmount?: number;

  /**
   * Coverage already credited to THIS event: federal income tax withheld +
   * state withholding when state tax is part of the target. MUST exclude
   * employee Social Security / Medicare.
   */
  creditedWithholding?: number;

  /** Prospective quarterly catch-up dollars offered for this event. */
  catchUpAmount?: number;
  /** False for historical / already-received events → catch-up is dropped. */
  isFutureOpportunity?: boolean;
  /**
   * Remaining annual tax after all counted credits. Caps the catch-up so
   * quarterly acceleration can never stack a second liability on top of the
   * event's allocated share.
   */
  annualRemainingTax?: number;

  /** W-2 funding mechanism. `annual_w4` = the W-4 card owns the deficit. */
  w2FundingMethod?: EventFundingMethod;

  /** Estimates unavailable → caller-supplied flat rate path. */
  forceFlatRatePct?: number | null;
}

export interface CanonicalEventRecommendation {
  allocation: AnnualTaxAllocation;
  target: EventTaxTarget;
  /** Tax this event is responsible for funding (before coverage/catch-up). */
  eventTaxTarget: number;
  /** Blended rate as a PERCENT of the event's taxable base (display only). */
  effectiveRatePct: number;
  /** Net taxable base for this event (gross − its pre-tax deductions). */
  netTaxableForEntry: number;
  /** Catch-up actually folded in, after future-event + liability clamping. */
  catchUpApplied: number;
  /** eventTaxTarget + catchUpApplied. */
  totalSuggestedReserve: number;
  /** Coverage credited to this event (FICA excluded by the caller). */
  creditedWithholding: number;
  /** What we still ask the user to set aside for this event. Floored at 0. */
  recommendedWithholding: number;
  /** Signed version (negative = over-covered). */
  signedRecommendation: number;
  /** True when a W-2 deficit is delivered through the annual W-4 instead. */
  fundedByAnnualW4: boolean;
  // ── Historical vs future eligibility (single centralized rule) ──────────
  /** False for events already received/completed. */
  isFutureOpportunity: boolean;
  /** This event's tax responsibility at the time (display only). */
  historicalTarget: number;
  /** Coverage credited to this historical event (display only). */
  historicalCoverage: number;
  /** Historical shortfall (target − coverage, floored at 0). Display only. */
  historicalShortfall: number;
  /** Actionable future funding ask. Always 0 for historical events. */
  recommendedFutureFunding: number;
  /** Component breakdown kept for existing tooltips / UI. */
  rateBreakdown: SavingsRateResult;
  methodLabel: string;
  basis: "flat_rate" | "canonical_allocation";
}


function resolveSourceType(incomeType: string, incomeBucket?: "personal" | "business"): AllocationSourceType {
  const raw = (incomeType ?? "").toLowerCase();
  if (raw.includes("investment") || raw.includes("dividend") || raw.includes("capital")) {
    return "investment";
  }
  const filing = normalizeFilingType(incomeType);
  if (isW2FilingType(filing) || incomeBucket === "personal") return "w2";
  if (filing === "scorp_w2") return "scorp_w2";
  if (raw.includes("k1")) return "k1";
  return "1099";
}

function isSETaxable(input: CanonicalEventRecommendationInput): boolean {
  if (input.includeSETaxInRecommendation === false) return false;
  if (input.isSelfEmploymentTaxable != null) return !!input.isSelfEmploymentTaxable;
  const filing = normalizeFilingType(input.incomeType);
  const raw = (input.incomeType ?? "").toLowerCase();
  return filing === "1099_schedule_c" || raw.includes("k1");
}

/**
 * The single canonical per-event recommendation.
 */
export function computeCanonicalEventRecommendation(
  input: CanonicalEventRecommendationInput,
): CanonicalEventRecommendation | null {
  const gross = pos(input.grossIncome);
  if (gross <= 0) return null;

  const allocation = input.allocation ?? buildAllocationFromEstimate(input.estimate);
  const sourceType = resolveSourceType(input.incomeType, input.incomeBucket);
  const isW2 = sourceType === "w2" || sourceType === "scorp_w2";
  const bucket = input.incomeBucket ?? (isW2 ? "personal" : "business");

  const netTaxableForEntry = Math.max(
    0,
    gross - pos(input.retirement401k) - pos(input.preTaxDeductions),
  );
  const preferentialAmount = Math.min(pos(input.preferentialAmount), netTaxableForEntry);
  const ordinaryTaxBase = Math.max(0, netTaxableForEntry - preferentialAmount);

  const settings = input.taxSettings ?? {};
  const profile = getSelectedWithholdingProfileRate({
    taxSettings: settings,
    actualEstimate: input.estimate,
    currentPaceEstimate: input.estimate,
    forecastEstimate: input.estimate,
  });

  // Legacy component breakdown is still used by tooltips and the SE wage-base
  // explainer. It is DISPLAY metadata only — never the recommendation.
  const rateBreakdown = getSavingsRateForIncomeBucket({
    incomeBucket: bucket,
    incomeType: input.incomeType,
    taxSettings: settings,
    actualEstimate: input.estimate,
    currentPaceEstimate: input.estimate,
    forecastEstimate: input.estimate,
    companyId: input.companyId,
    applyBusinessStateTax: input.applyBusinessStateTax,
    includeSETaxInRecommendation: input.includeSETaxInRecommendation,
    isSelfEmploymentTaxable: input.isSelfEmploymentTaxable,
    filingStatus: input.filingStatus ?? undefined,
    currentW2Wages: pos(input.estimate?.w2Income),
    currentNetSEIncome: pos(input.estimate?.seIncome),
    entryGrossAmount: netTaxableForEntry,
  });

  const flatRatePct =
    input.forceFlatRatePct != null
      ? Math.max(0, input.forceFlatRatePct)
      : profile.methodUsed === "flat_estimate"
        ? rateBreakdown.rate
        : null;

  let target: EventTaxTarget;
  let basis: CanonicalEventRecommendation["basis"];

  if (flatRatePct != null) {
    // Explicit user-chosen flat rate. Not a competing model of the tax law —
    // it is the user overriding the rate. Still funnelled through the same
    // event-target shape so downstream code has one contract.
    const totalFlat = round2(netTaxableForEntry * (flatRatePct / 100));
    target = {
      federalIncomeTax: totalFlat,
      personalStateTax: 0,
      selfEmploymentTax: 0,
      businessStateTax: 0,
      investmentTax: 0,
      total: totalFlat,
      effectiveRatePct: flatRatePct,
    };
    basis = "flat_rate";
  } else {
    const seApplies = !isW2 && sourceType !== "investment" && isSETaxable(input);
    const seRate = seApplies
      ? getMarginalSelfEmploymentRateFraction({
          incomeBucket: "business",
          incomeType: input.incomeType,
          taxSettings: settings,
          actualEstimate: input.estimate,
          currentPaceEstimate: input.estimate,
          forecastEstimate: input.estimate,
          companyId: input.companyId,
          applyBusinessStateTax: input.applyBusinessStateTax,
          includeSETaxInRecommendation: input.includeSETaxInRecommendation,
          isSelfEmploymentTaxable: input.isSelfEmploymentTaxable,
          filingStatus: input.filingStatus ?? undefined,
          currentW2Wages: pos(input.estimate?.w2Income),
          currentNetSEIncome: pos(input.estimate?.seIncome),
          entryGrossAmount: netTaxableForEntry,
        })
      : 0;
    const businessStateRate =
      isW2 || sourceType === "investment"
        ? 0
        : getBusinessStateRateForEntry(settings, {
            companyId: input.companyId,
            applyBusinessStateTax: input.applyBusinessStateTax,
          }) / 100;

    target = computeEventTaxTarget({
      allocation,
      sourceType,
      ordinaryTaxBase,
      preferentialTaxBase: preferentialAmount,
      // Personal state tax never attaches to business profit — the annual
      // engine excludes it from the personal state base.
      personalStateTaxBase: isW2 || sourceType === "investment" ? ordinaryTaxBase : 0,
      selfEmploymentBase: seApplies ? netTaxableForEntry : 0,
      selfEmploymentRate: seRate,
      businessStateTaxRate: businessStateRate,
      businessStateTaxBase: netTaxableForEntry,
    });
    basis = "canonical_allocation";
  }

  const eventTaxTarget = round2(target.total);

  // ── Catch-up: redistribution of the SAME remaining obligation ───────────
  const fundedByAnnualW4 = isW2 && input.w2FundingMethod === "annual_w4";
  const isFuture = input.isFutureOpportunity !== false;
  let catchUpApplied = isFuture && !fundedByAnnualW4 ? pos(input.catchUpAmount) : 0;
  if (input.annualRemainingTax != null) {
    catchUpApplied = Math.min(catchUpApplied, pos(input.annualRemainingTax));
  }
  catchUpApplied = round2(catchUpApplied);

  const creditedWithholding = round2(pos(input.creditedWithholding));
  const totalSuggestedReserve = round2(eventTaxTarget + catchUpApplied);
  // Annual-W-4 method: the W-4 card funds this source's deficit through Step
  // 4(c) withholding, so the paycheck surface must NOT also ask for savings.
  const signedRecommendation = fundedByAnnualW4
    ? 0
    : round2(totalSuggestedReserve - creditedWithholding);

  // Historical events are history: they keep their target/coverage for
  // display but NEVER receive an actionable future funding ask.
  const historicalShortfall = Math.max(0, round2(eventTaxTarget - creditedWithholding));
  const recommendedFutureFunding = isFuture ? Math.max(0, signedRecommendation) : 0;

  return {
    allocation,
    target,
    eventTaxTarget,
    effectiveRatePct:
      netTaxableForEntry > 0 ? round2((eventTaxTarget / netTaxableForEntry) * 100) : 0,
    netTaxableForEntry: round2(netTaxableForEntry),
    catchUpApplied,
    totalSuggestedReserve,
    creditedWithholding,
    recommendedWithholding: recommendedFutureFunding,
    signedRecommendation,
    fundedByAnnualW4,
    isFutureOpportunity: isFuture,
    historicalTarget: eventTaxTarget,
    historicalCoverage: creditedWithholding,
    historicalShortfall,
    recommendedFutureFunding,

    rateBreakdown: {
      ...rateBreakdown,
      // Report the rate the recommendation actually used.
      rate: flatRatePct != null ? flatRatePct : round2(target.effectiveRatePct),
    },
    methodLabel: profile.label,
    basis,
  };
}

/**
 * Canonical set-aside RATE (percent) for an income bucket.
 *
 * Replaces the legacy blended `getSavingsRateForIncomeBucket().rate` on
 * display surfaces (Dashboard, Tax Overview, the W-4 card's future business
 * reserve) so every screen quotes the same allocation the per-event
 * recommendation uses. Derived by running the canonical event pipeline on a
 * reference amount — never an independent formula.
 */
export function getCanonicalBucketRatePct(input: {
  estimate: TaxEstimate | null | undefined;
  taxSettings: SavingsRateSettingsLike | null | undefined;
  bucket: "personal" | "business";
  incomeType?: string;
  companyId?: string | null;
  applyBusinessStateTax?: boolean | null;
  includeSETaxInRecommendation?: boolean | null;
  filingStatus?: "single" | "married_filing_jointly" | null;
  /** Reference amount used to resolve wage-base-sensitive SE rates. */
  referenceAmount?: number;
}): number {
  const reference = pos(input.referenceAmount) || 10000;
  const rec = computeCanonicalEventRecommendation({
    estimate: input.estimate,
    taxSettings: input.taxSettings,
    incomeType: input.incomeType ?? (input.bucket === "personal" ? "w2" : "1099"),
    incomeBucket: input.bucket,
    grossIncome: reference,
    companyId: input.companyId,
    applyBusinessStateTax: input.applyBusinessStateTax,
    includeSETaxInRecommendation: input.includeSETaxInRecommendation ?? true,
    filingStatus: input.filingStatus ?? undefined,
    creditedWithholding: 0,
    catchUpAmount: 0,
    // A bucket rate is a pure rate — no W-4 funding gate, no catch-up.
    w2FundingMethod: "paycheck_target",
  });
  return rec ? round2(rec.effectiveRatePct) : 0;
}
