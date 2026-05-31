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

export type RecommendationStatus = "ahead" | "on_track" | "behind";
export type RecommendationConfidence = "high" | "estimated" | "low";

export interface IncomeRecommendation {
  /** Base tax estimate for this specific paycheck */
  baseTaxEstimate: number;
  /** Per-entry tax target before subtracting taxes already withheld */
  dynamicTaxRecommendation: number;
  /** Deprecated compatibility field; paycheck recommendations do not add catch-up */
  quarterlyAdjustmentAmount: number;
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
  companyId?: string | null;
  applyBusinessStateTax?: boolean | null;
  includeSETaxInRecommendation?: boolean | null;
}

// getNextQuarterDeadline now lives in src/lib/quarters.ts (shared helper).

export function useIncomeRecommendation() {
  const { actualEstimate, currentPaceEstimate, forecastEstimate, isLoading: estLoading } = useTaxEstimate();
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();
  const isLoading = estLoading || settingsLoading;

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
      const quarterlyAdjustmentAmount = 0;
      const recommendationStatus: RecommendationStatus = "on_track";
      const shortfallOrSurplus = 0;
      const totalShortfallByDeadline = 0;
      const confidence: RecommendationConfidence = "high";
      const spreadExplanation = "Based on this paycheck only";
      const projectedEventsUsed = 0;

      const actualWithheld = federalWithheld + stateWithheld;
      const recommendedAdditionalReserve = Math.max(0, Math.round((baseTaxEstimate - actualWithheld) * 100) / 100);

      const totalSuggestedReserve = Math.round((baseTaxEstimate + quarterlyAdjustmentAmount) * 100) / 100;

      return {
        baseTaxEstimate,
        dynamicTaxRecommendation,
        quarterlyAdjustmentAmount,
        totalSuggestedReserve,
        recommendationStatus,
        shortfallOrSurplus,
        totalShortfallByDeadline,
        recommendedAdditionalReserve,
        projectedEventsBeforeDeadline: projectedEventsUsed,
        confidence,
        spreadExplanation,
        effectiveRate,
        methodLabel,
        isDynamicEnabled: false,
        nextDeadlineLabel: "this paycheck",
      };
    };
  }, [actualEstimate, currentPaceEstimate, forecastEstimate, settings]);

  return { getRecommendation, isLoading };
}
