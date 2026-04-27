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
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks } from "@/hooks/useProjectedIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { isW2FilingType } from "@/lib/filingTypes";
import { getNextQuarterDeadline } from "@/lib/quarters";
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
  const { data: taxPayments = [], isLoading: tpLoading } = useTaxPayments();
  const { data: taxSavings = [], isLoading: tsLoading } = useTaxSavings();
  const { data: streams = [], isLoading: strLoading } = useProjectedStreams();
  const { data: bonuses = [], isLoading: bonLoading } = useProjectedBonuses();
  const { data: personalEntries = [], isLoading: piLoading } = usePersonalIncomeEntries();

  const isLoading = estLoading || settingsLoading || tpLoading || tsLoading || strLoading || bonLoading || piLoading;

  const isDynamicEnabled = isFeatureEnabled("dynamic_paycheck_recommendation");
  const isQuarterlyEnabled = isFeatureEnabled("quarterly_payment_tracking");

  const quarterInfo = useMemo(() => getNextQuarterDeadline(), []);

  // Count projected income events between now and next deadline
  const projectedEventCount = useMemo(() => {
    if (!streams.length && !bonuses.length) return 0;
    const allPaychecks = generateProjectedPaychecks(streams, bonuses, personalEntries);
    const deadlineStr = quarterInfo.deadline.toISOString().split("T")[0];
    return allPaychecks.filter(
      (p) => !p.isSkipped && p.date <= deadlineStr
    ).length;
  }, [streams, bonuses, personalEntries, quarterInfo]);

  // Estimate historical cadence as fallback
  const historicalCadenceEstimate = useMemo(() => {
    if (personalEntries.length < 2) return null;
    // Sort by date ascending
    const sorted = [...personalEntries].sort((a, b) => a.income_date.localeCompare(b.income_date));
    // Look at the last 6 months of entries
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthStr = sixMonthsAgo.toISOString().split("T")[0];
    const recent = sorted.filter((e) => e.income_date >= sixMonthStr);
    if (recent.length < 2) return null;

    // Calculate average days between entries
    let totalDays = 0;
    for (let i = 1; i < recent.length; i++) {
      const d1 = new Date(recent[i - 1].income_date);
      const d2 = new Date(recent[i].income_date);
      totalDays += (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
    }
    const avgDaysBetween = totalDays / (recent.length - 1);
    if (avgDaysBetween <= 0 || avgDaysBetween > 90) return null; // unreasonable

    // Estimate events between now and deadline
    const now = new Date();
    const daysToDeadline = Math.max(1, (quarterInfo.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const estimatedEvents = Math.max(1, Math.round(daysToDeadline / avgDaysBetween));

    return {
      avgDaysBetween: Math.round(avgDaysBetween),
      estimatedEvents,
      recentCount: recent.length,
    };
  }, [personalEntries, quarterInfo]);

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
        }).rate;
        baseTaxEstimate = netTaxable * (rateToUse / 100);
        effectiveRate = rateToUse;
        methodLabel = profile.label;
      }

      baseTaxEstimate = Math.round(baseTaxEstimate * 100) / 100;

      // ── PER-ENTRY RESERVE RECOMMENDATION ──
      let dynamicTaxRecommendation = baseTaxEstimate;
      let quarterlyAdjustmentAmount = 0;
      let recommendationStatus: RecommendationStatus = "on_track";
      let shortfallOrSurplus = 0;
      let totalShortfallByDeadline = 0;
      let recommendedAdditionalReserve = 0;
      let confidence: RecommendationConfidence = "high";
      let spreadExplanation = "Based on this paycheck only";
      let projectedEventsUsed = 0;

      const actualWithheld = federalWithheld + stateWithheld;
      recommendedAdditionalReserve = Math.max(0, Math.round((baseTaxEstimate - actualWithheld) * 100) / 100);

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
        isDynamicEnabled,
        nextDeadlineLabel: quarterInfo.quarterLabel,
      };
    };
  }, [actualEstimate, currentPaceEstimate, forecastEstimate, settings, taxPayments, taxSavings, isDynamicEnabled, isQuarterlyEnabled, quarterInfo, projectedEventCount, historicalCadenceEstimate]);

  return { getRecommendation, isLoading };
}
