/**
 * Smart Income Recommendation Engine
 * 
 * Calculates base tax estimate, dynamic recommendation, quarterly status,
 * and additional tax reserve for income entries.
 * 
 * Uses projected income streams from Income Planner as the primary source
 * for estimating remaining income events before the next tax deadline.
 * Falls back to historical cadence or total shortfall when projections are absent.
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
  /** Dynamic recommendation using full-year tax picture */
  dynamicTaxRecommendation: number;
  /** Quarterly catch-up or reduction amount */
  quarterlyAdjustmentAmount: number;
  /** Total suggested tax reserve (base + quarterly adjustment) */
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
  federalWithheld: number;
  stateWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
}

// getNextQuarterDeadline now lives in src/lib/quarters.ts (shared helper).

export function useIncomeRecommendation() {
  const { actualEstimate, forecastEstimate, isLoading: estLoading } = useTaxEstimate();
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
      const { grossIncome, incomeType, federalWithheld, stateWithheld, retirement401k, preTaxDeductions } = input;

      if (!settings || grossIncome <= 0) return null;

      const isW2 = isW2FilingType(incomeType);
      const withholdingMethod = settings.withholdingMethod || "dynamic_actual";
      const profile = getSelectedWithholdingProfileRate({ taxSettings: settings, actualEstimate, forecastEstimate });

      // Net taxable for this entry
      const netTaxable = Math.max(0, grossIncome - retirement401k - preTaxDeductions);

      // ── BASE TAX ESTIMATE (always available, core feature) ──
      let baseTaxEstimate: number;
      let effectiveRate: number;
      let methodLabel: string;

      if (withholdingMethod === "flat_estimate") {
        const rateSel = getSavingsRateForIncomeBucket({
          incomeBucket: isW2 ? "personal" : "business",
          incomeType,
          taxSettings: settings,
          actualEstimate,
          forecastEstimate,
        });
        baseTaxEstimate = netTaxable * (rateSel.rate / 100);
        effectiveRate = rateSel.rate;
        methodLabel = rateSel.label;
      } else {
        const estimate = withholdingMethod === "dynamic_planner" ? forecastEstimate : actualEstimate;
        if (!estimate) return null;
        const rateToUse = getSavingsRateForIncomeBucket({
          incomeBucket: isW2 ? "personal" : "business",
          incomeType,
          taxSettings: settings,
          actualEstimate,
          forecastEstimate,
        }).rate;
        baseTaxEstimate = netTaxable * (rateToUse / 100);
        effectiveRate = rateToUse;
        methodLabel = profile.label;
      }

      baseTaxEstimate = Math.round(baseTaxEstimate * 100) / 100;

      // ── DYNAMIC RECOMMENDATION (premium feature) ──
      let dynamicTaxRecommendation = baseTaxEstimate;
      let quarterlyAdjustmentAmount = 0;
      let recommendationStatus: RecommendationStatus = "on_track";
      let shortfallOrSurplus = 0;
      let totalShortfallByDeadline = 0;
      let recommendedAdditionalReserve = 0;
      let confidence: RecommendationConfidence = "high";
      let spreadExplanation = "";
      let projectedEventsUsed = 0;

      if (isDynamicEnabled && isQuarterlyEnabled) {
        const estimate = withholdingMethod === "dynamic_planner" ? forecastEstimate : actualEstimate;
        if (estimate) {
          const annualTax = estimate.totalTaxLiability;
          const quarterFraction = quarterInfo.quarter / 4;
          const targetByNextDeadline = annualTax * quarterFraction;

          const totalWithheld = estimate.taxesAlreadyWithheld;
          const quarterlyPaid = taxPayments.reduce((s, p) => s + Number(p.amount), 0);
          // Savings set aside is informational only — NOT a submitted tax payment, so it
          // does NOT count as money applied against the bill.
          const totalCovered = totalWithheld + quarterlyPaid;

          shortfallOrSurplus = Math.round((targetByNextDeadline - totalCovered) * 100) / 100;
          totalShortfallByDeadline = Math.max(0, shortfallOrSurplus);

          if (shortfallOrSurplus > 100) {
            recommendationStatus = "behind";

            // ── SPREAD LOGIC: use projected income as primary source ──
            if (projectedEventCount > 0) {
              // High confidence: we know exactly how many income events are coming
              projectedEventsUsed = projectedEventCount;
              quarterlyAdjustmentAmount = Math.round((shortfallOrSurplus / projectedEventCount) * 100) / 100;
              confidence = "high";
              spreadExplanation = `Spread across ${projectedEventCount} projected income event${projectedEventCount > 1 ? "s" : ""} before ${quarterInfo.quarterLabel}`;
            } else if (historicalCadenceEstimate) {
              // Estimated confidence: using recent income patterns
              projectedEventsUsed = historicalCadenceEstimate.estimatedEvents;
              quarterlyAdjustmentAmount = Math.round((shortfallOrSurplus / historicalCadenceEstimate.estimatedEvents) * 100) / 100;
              confidence = "estimated";
              spreadExplanation = `Estimated across ~${historicalCadenceEstimate.estimatedEvents} income event${historicalCadenceEstimate.estimatedEvents > 1 ? "s" : ""} (based on recent ~${historicalCadenceEstimate.avgDaysBetween}-day cadence)`;
            } else {
              // Low confidence: no projections or historical pattern — show total shortfall
              projectedEventsUsed = 0;
              quarterlyAdjustmentAmount = shortfallOrSurplus; // full amount on this transaction
              confidence = "low";
              spreadExplanation = `Total shortfall by ${quarterInfo.quarterLabel} — add projected income in Income Planner for per-paycheck guidance`;
            }
          } else if (shortfallOrSurplus < -100) {
            recommendationStatus = "ahead";
            quarterlyAdjustmentAmount = 0;
            confidence = "high";
            spreadExplanation = "No catch-up needed — you are ahead";
          } else {
            recommendationStatus = "on_track";
            quarterlyAdjustmentAmount = 0;
            confidence = "high";
            spreadExplanation = "On track for next estimated payment";
          }

          dynamicTaxRecommendation = Math.round((baseTaxEstimate + quarterlyAdjustmentAmount) * 100) / 100;

          const actualWithheld = federalWithheld + stateWithheld;
          recommendedAdditionalReserve = Math.max(0, Math.round((dynamicTaxRecommendation - actualWithheld) * 100) / 100);
        }
      } else {
        const actualWithheld = federalWithheld + stateWithheld;
        recommendedAdditionalReserve = Math.max(0, Math.round((baseTaxEstimate - actualWithheld) * 100) / 100);
        dynamicTaxRecommendation = baseTaxEstimate;
        confidence = "high";
        spreadExplanation = "Based on this paycheck only";
      }

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
  }, [actualEstimate, forecastEstimate, settings, taxPayments, taxSavings, isDynamicEnabled, isQuarterlyEnabled, quarterInfo, projectedEventCount, historicalCadenceEstimate]);

  return { getRecommendation, isLoading };
}
