/**
 * Smart Income Recommendation Engine
 * 
 * Calculates per-entry tax reserve guidance for income entries.
 *
 * This intentionally does NOT spread annual or quarterly shortfalls across
 * future paychecks. Each recommendation answers: based on this entry's taxable
 * base and selected effective tax rate, how much extra should be saved after
 * taxes already withheld on this entry?
 */

import { useMemo } from "react";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { isW2FilingType } from "@/lib/filingTypes";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";
import { useQuarterRecommendationInput } from "@/hooks/useQuarterRecommendationInput";
import { buildQuarterRecommendation, getActivePaymentTarget } from "@/lib/quarterRecommendation";
import {
  computeCatchUpRecommendation,
  countRemainingOpportunities,
  type CatchUpResult,
  type CoverageStatus,
} from "@/lib/catchUpRecommendation";

export type RecommendationStatus = "ahead" | "on_track" | "behind";
export type RecommendationConfidence = "high" | "estimated" | "low";

export interface IncomeRecommendation {
  /** Base tax estimate for this specific paycheck */
  baseTaxEstimate: number;
  /** Per-entry tax target before subtracting taxes already withheld */
  dynamicTaxRecommendation: number;
  /** Prospective catch-up folded into this paycheck's recommendation. */
  quarterlyAdjustmentAmount: number;
  /** Employee SS+Medicare removed from the credit (never offsets income tax). */
  ficaExcludedFromCredits: number;
  /** Detailed 5-value coverage status for this quarter. */
  coverageStatus: CoverageStatus;
  /** Short status label. */
  statusHeadline: string;
  /** Plain-language explanation (distinguishes a moved estimate from undersaving). */
  statusDetail: string;
  /** Quarter-level catch-up context. */
  catchUp: CatchUpResult;
  /** Per-entry tax target before subtracting taxes already withheld */
  totalSuggestedReserve: number;
  /** User's status for next estimated payment */
  recommendationStatus: RecommendationStatus;
  /** Shortfall (positive) or surplus (negative) for next estimated payment */
  shortfallOrSurplus: number;
  /** Total shortfall needed by the next deadline (always exact) */
  totalShortfallByDeadline: number;
  /** Recommended additional tax reserve per income event */
  recommendedAdditionalReserve: number;
  /** Number of projected income events before deadline (0 if using fallback) */
  projectedEventsBeforeDeadline: number;
  /** Whether recommendation is based on projected income or a fallback */
  confidence: RecommendationConfidence;
  /** Human-readable explanation of how the spread was calculated */
  spreadExplanation: string;
  /** Effective tax rate used */
  effectiveRate: number;
  /** Method label */
  methodLabel: string;
  /** Whether dynamic features are enabled */
  isDynamicEnabled: boolean;
  /** Next quarterly deadline label */
  nextDeadlineLabel: string;
}

interface RecommendationInput {
  grossIncome: number;
  incomeType: string;
  incomeBucket?: "personal" | "business";
  federalWithheld: number;
  stateWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
  /** Employee SS+Medicare included in `federalWithheld`; excluded from credit. */
  ficaWithheldNotCredited?: number;
  /** Whether state income tax is part of the target (gates the state credit). */
  stateTaxIncludedInTarget?: boolean;
  /** Explicit catch-up; omit for the live quarterly shortfall, 0 to opt out. */
  catchUpAmount?: number;
  companyId?: string | null;
  applyBusinessStateTax?: boolean | null;
  includeSETaxInRecommendation?: boolean | null;
}

// getNextQuarterDeadline now lives in src/lib/quarters.ts (shared helper).

export function useIncomeRecommendation() {
  const { actualEstimate, currentPaceEstimate, forecastEstimate, isLoading: estLoading } = useTaxEstimate();
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();
  const quarterInput = useQuarterRecommendationInput();
  const isLoading = estLoading || settingsLoading;

  /**
   * Live quarter shortfall spread across the paychecks that are STILL AHEAD.
   * Prospective only — earlier recommendations are never rewritten.
   */
  const catchUpContext = useMemo<CatchUpResult>(() => {
    const target = getActivePaymentTarget();
    const quarterRec = buildQuarterRecommendation({
      ...quarterInput,
      year: target.year,
      quarter: target.quarter,
    });
    const remainingOpportunities = countRemainingOpportunities(
      quarterInput.projectedPaychecks,
      new Date(),
      quarterRec.deadline,
    );
    return computeCatchUpRecommendation({
      quarterTarget: quarterRec.quarterTarget,
      coveredSoFar: quarterRec.progressAmount,
      remainingOpportunities,
      // Carry the canonical baseline through: without it this recomputation
      // could never classify "estimate_increased", so a user who had satisfied
      // every prior recommendation still saw generic "stay on pace" copy after
      // new income raised the target.
      baselineQuarterTarget: quarterRec.baselineQuarterTarget,
    });
  }, [quarterInput]);

  /**
   * Same quarter status as `catchUpContext`, but with the recommendation that
   * the just-saved income event generated excluded from the prior-compliance
   * baseline. Without this, a brand-new (not yet acted on) recommendation makes
   * "estimate increased" unreachable and the UI falls back to generic copy.
   */
  const getCatchUpExcludingEntry = useMemo(() => {
    return (
      incomeEntryId?: string | null,
      opts?: { additionalQuarterTarget?: number },
    ): CatchUpResult => {
      const extra = Math.max(0, opts?.additionalQuarterTarget ?? 0);
      if (!incomeEntryId && extra <= 0) return catchUpContext;
      const target = getActivePaymentTarget();
      const quarterRec = buildQuarterRecommendation({
        ...quarterInput,
        year: target.year,
        quarter: target.quarter,
        ...(incomeEntryId ? { excludeRecommendationEntryIds: [incomeEntryId] } : {}),
      });
      const remainingOpportunities = countRemainingOpportunities(
        quarterInput.projectedPaychecks,
        new Date(),
        quarterRec.deadline,
      );
      // The caller runs immediately after saving the new income event, so the
      // cached quarter data still predates it. `additionalQuarterTarget` adds
      // the brand-new event's tax target so the moved target is visible here —
      // without it the status reads "on_track" and the modal shows generic copy.
      return computeCatchUpRecommendation({
        quarterTarget: quarterRec.quarterTarget + extra,
        coveredSoFar: quarterRec.progressAmount,
        remainingOpportunities,
        baselineQuarterTarget: quarterRec.baselineQuarterTarget,
      });
    };
  }, [quarterInput, catchUpContext]);


  const getRecommendation = useMemo(() => {
    return (input: RecommendationInput): IncomeRecommendation | null => {
      const { grossIncome, incomeType, incomeBucket, federalWithheld, stateWithheld, retirement401k, preTaxDeductions, companyId, applyBusinessStateTax, includeSETaxInRecommendation } = input;

      if (!settings || grossIncome <= 0) return null;

      const isW2 = isW2FilingType(incomeType);
      const resolvedBucket = incomeBucket ?? (isW2 ? "personal" : "business");
      const withholdingMethod = settings.withholdingMethod || "dynamic_planner";
      const profile = getSelectedWithholdingProfileRate({ taxSettings: settings, actualEstimate, currentPaceEstimate, forecastEstimate });

      // Net taxable for this entry
      const netTaxable = Math.max(0, grossIncome - retirement401k - preTaxDeductions);

      // ── BASE TAX ESTIMATE (always available, core feature) ──
      let baseTaxEstimate: number;
      let effectiveRate: number;
      let methodLabel: string;

      if (withholdingMethod === "flat_estimate") {
        const rateSel = getSavingsRateForIncomeBucket({
          incomeBucket: resolvedBucket,
          incomeType,
          taxSettings: settings,
          actualEstimate,
          currentPaceEstimate,
          forecastEstimate,
          companyId,
          applyBusinessStateTax,
          includeSETaxInRecommendation,
          filingStatus: (settings as any)?.filingStatus ?? undefined,
          entryGrossAmount: netTaxable,
        });
        baseTaxEstimate = netTaxable * (rateSel.rate / 100);
        effectiveRate = rateSel.rate;
        methodLabel = rateSel.label;
      } else {
        const estimate = withholdingMethod === "dynamic_planner" ? forecastEstimate : (currentPaceEstimate ?? actualEstimate);
        if (!estimate) return null;
        const rateToUse = getSavingsRateForIncomeBucket({
          incomeBucket: resolvedBucket,
          incomeType,
          taxSettings: settings,
          actualEstimate,
          currentPaceEstimate,
          forecastEstimate,
          companyId,
          applyBusinessStateTax,
          includeSETaxInRecommendation,
          filingStatus: (settings as any)?.filingStatus ?? undefined,
          entryGrossAmount: netTaxable,
        }).rate;
        baseTaxEstimate = netTaxable * (rateToUse / 100);
        effectiveRate = rateToUse;
        methodLabel = profile.label;
      }

      baseTaxEstimate = Math.round(baseTaxEstimate * 100) / 100;

      // ── PER-ENTRY RESERVE RECOMMENDATION ──
      const dynamicTaxRecommendation = baseTaxEstimate;
      const quarterlyAdjustmentAmount =
        input.catchUpAmount != null
          ? Math.max(0, Math.round(input.catchUpAmount * 100) / 100)
          : catchUpContext.quarterlyAdjustmentAmount;
      const recommendationStatus: RecommendationStatus = catchUpContext.legacyStatus;
      const shortfallOrSurplus = catchUpContext.shortfallOrSurplus;
      const totalShortfallByDeadline = catchUpContext.totalShortfallByDeadline;
      const confidence: RecommendationConfidence = "high";
      const spreadExplanation =
        quarterlyAdjustmentAmount > 0
          ? `This paycheck plus a catch-up share of this quarter's shortfall, spread across your remaining ${catchUpContext.remainingOpportunities} paycheck(s)`
          : "Based on this paycheck only";
      const projectedEventsUsed = catchUpContext.remainingOpportunities;

      // FICA is never an income-tax credit; state counts only when it is part
      // of the target.
      const ficaExcludedFromCredits = Math.max(0, Number(input.ficaWithheldNotCredited) || 0);
      const creditedFederal = Math.max(0, federalWithheld - ficaExcludedFromCredits);
      const creditedState = input.stateTaxIncludedInTarget === false ? 0 : stateWithheld;
      const actualWithheld = creditedFederal + creditedState;
      const totalSuggestedReserve = Math.round((baseTaxEstimate + quarterlyAdjustmentAmount) * 100) / 100;
      const recommendedAdditionalReserve = Math.max(
        0,
        Math.round((totalSuggestedReserve - actualWithheld) * 100) / 100,
      );

      return {
        baseTaxEstimate,
        dynamicTaxRecommendation,
        quarterlyAdjustmentAmount,
        totalSuggestedReserve,
        recommendationStatus,
        shortfallOrSurplus,
        totalShortfallByDeadline,
        recommendedAdditionalReserve,
        ficaExcludedFromCredits,
        coverageStatus: catchUpContext.recommendationStatus,
        statusHeadline: catchUpContext.statusHeadline,
        statusDetail: catchUpContext.statusDetail,
        catchUp: catchUpContext,
        projectedEventsBeforeDeadline: projectedEventsUsed,
        confidence,
        spreadExplanation,
        effectiveRate,
        methodLabel,
        isDynamicEnabled: quarterlyAdjustmentAmount > 0,
        nextDeadlineLabel: "this paycheck",
      };
    };
  }, [actualEstimate, currentPaceEstimate, forecastEstimate, settings, catchUpContext]);

  return { getRecommendation, getCatchUpExcludingEntry, isLoading };
}
