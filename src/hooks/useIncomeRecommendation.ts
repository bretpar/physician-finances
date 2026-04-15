/**
 * Smart Income Recommendation Engine
 * 
 * Calculates base tax estimate, dynamic recommendation, quarterly status,
 * and additional tax reserve for income entries.
 * 
 * Separated from useWithholdingRecommendation to keep concerns distinct:
 * - useWithholdingRecommendation = per-entry withholding amount
 * - useIncomeRecommendation = full post-save smart guidance with quarterly tracking
 */

import { useMemo } from "react";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { SE_TAX_RATE, SE_INCOME_FACTOR } from "@/lib/taxEngine";
import { isFeatureEnabled } from "@/lib/featureFlags";

export type RecommendationStatus = "ahead" | "on_track" | "behind";

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
  /** Recommended additional tax reserve */
  recommendedAdditionalReserve: number;
  /** Effective tax rate used */
  effectiveRate: number;
  /** Method label */
  methodLabel: string;
  /** Whether dynamic features are enabled */
  isDynamicEnabled: boolean;
}

interface RecommendationInput {
  grossIncome: number;
  incomeType: string; // 'W2' | '1099' | 'K1' | 'other'
  federalWithheld: number;
  stateWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
}

function getCurrentQuarter(): { quarter: number; deadline: Date; quarterLabel: string } {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  if (month < 3) return { quarter: 1, deadline: new Date(now.getFullYear(), 3, 15), quarterLabel: "Q1" };
  if (month < 5) return { quarter: 2, deadline: new Date(now.getFullYear(), 5, 15), quarterLabel: "Q2" };
  if (month < 8) return { quarter: 3, deadline: new Date(now.getFullYear(), 8, 15), quarterLabel: "Q3" };
  return { quarter: 4, deadline: new Date(now.getFullYear() + 1, 0, 15), quarterLabel: "Q4" };
}

export function useIncomeRecommendation() {
  const { actualEstimate, forecastEstimate, isLoading: estLoading } = useTaxEstimate();
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();
  const { data: taxPayments = [], isLoading: tpLoading } = useTaxPayments();
  const { data: taxSavings = [], isLoading: tsLoading } = useTaxSavings();

  const isLoading = estLoading || settingsLoading || tpLoading || tsLoading;

  const isDynamicEnabled = isFeatureEnabled("dynamic_paycheck_recommendation");
  const isQuarterlyEnabled = isFeatureEnabled("quarterly_payment_tracking");

  const quarterInfo = useMemo(() => getCurrentQuarter(), []);

  const getRecommendation = useMemo(() => {
    return (input: RecommendationInput): IncomeRecommendation | null => {
      const { grossIncome, incomeType, federalWithheld, stateWithheld, retirement401k, preTaxDeductions } = input;

      if (!settings || grossIncome <= 0) return null;

      const isW2 = incomeType === "W2" || incomeType === "w2_user" || incomeType === "w2_partner";
      const withholdingMethod = settings.withholdingMethod || "dynamic_actual";

      // Net taxable for this entry
      const netTaxable = Math.max(0, grossIncome - retirement401k - preTaxDeductions);

      // ── BASE TAX ESTIMATE (always available, core feature) ──
      let baseTaxEstimate: number;
      let effectiveRate: number;
      let methodLabel: string;

      if (withholdingMethod === "flat_estimate") {
        const flatRate = settings.manualEffectiveTaxRate ?? 20;
        baseTaxEstimate = netTaxable * (flatRate / 100);
        if (!isW2) {
          baseTaxEstimate += netTaxable * SE_INCOME_FACTOR * SE_TAX_RATE;
        }
        effectiveRate = flatRate;
        methodLabel = `Flat ${flatRate}% estimate`;
      } else {
        const estimate = withholdingMethod === "dynamic_planner" ? forecastEstimate : actualEstimate;
        if (!estimate) return null;
        const rateToUse = isW2 ? estimate.federalEffectiveRate : estimate.effectiveRate;
        baseTaxEstimate = netTaxable * (rateToUse / 100);
        effectiveRate = rateToUse;
        methodLabel = withholdingMethod === "dynamic_planner"
          ? "Based on actual + planned income"
          : "Based on combined actual income";
      }

      baseTaxEstimate = Math.round(baseTaxEstimate * 100) / 100;

      // ── DYNAMIC RECOMMENDATION (premium feature) ──
      let dynamicTaxRecommendation = baseTaxEstimate;
      let quarterlyAdjustmentAmount = 0;
      let recommendationStatus: RecommendationStatus = "on_track";
      let shortfallOrSurplus = 0;
      let recommendedAdditionalReserve = 0;

      if (isDynamicEnabled && isQuarterlyEnabled) {
        const estimate = withholdingMethod === "dynamic_planner" ? forecastEstimate : actualEstimate;
        if (estimate) {
          // Total annual tax liability
          const annualTax = estimate.totalTaxLiability;
          
          // What should be paid by next quarterly deadline
          const quarterFraction = quarterInfo.quarter / 4;
          const targetByNextDeadline = annualTax * quarterFraction;

          // What's already covered
          const totalWithheld = estimate.taxesAlreadyWithheld;
          const quarterlyPaid = taxPayments.reduce((s, p) => s + Number(p.amount), 0);
          const savingsTotal = taxSavings.reduce((s, e) => s + Number(e.amount), 0);
          const totalCovered = totalWithheld + quarterlyPaid + savingsTotal;

          // Shortfall/surplus
          shortfallOrSurplus = Math.round((targetByNextDeadline - totalCovered) * 100) / 100;

          if (shortfallOrSurplus > 100) {
            recommendationStatus = "behind";
            // Spread the shortfall across remaining paychecks in the quarter (estimate ~2 per month)
            const now = new Date();
            const monthsToDeadline = Math.max(1, (quarterInfo.deadline.getMonth() - now.getMonth()) + 
              (quarterInfo.deadline.getFullYear() - now.getFullYear()) * 12);
            const estimatedRemainingPaychecks = Math.max(1, monthsToDeadline * 2);
            quarterlyAdjustmentAmount = Math.round((shortfallOrSurplus / estimatedRemainingPaychecks) * 100) / 100;
          } else if (shortfallOrSurplus < -100) {
            recommendationStatus = "ahead";
            quarterlyAdjustmentAmount = 0;
          } else {
            recommendationStatus = "on_track";
            quarterlyAdjustmentAmount = 0;
          }

          dynamicTaxRecommendation = Math.round((baseTaxEstimate + quarterlyAdjustmentAmount) * 100) / 100;
          
          // Recommended additional reserve = dynamic recommendation minus what's already withheld from this paycheck
          const actualWithheld = federalWithheld + stateWithheld;
          recommendedAdditionalReserve = Math.max(0, Math.round((dynamicTaxRecommendation - actualWithheld) * 100) / 100);
        }
      } else {
        // Non-dynamic mode: simple recommendation
        const actualWithheld = federalWithheld + stateWithheld;
        recommendedAdditionalReserve = Math.max(0, Math.round((baseTaxEstimate - actualWithheld) * 100) / 100);
        dynamicTaxRecommendation = baseTaxEstimate;
      }

      const totalSuggestedReserve = Math.round((baseTaxEstimate + quarterlyAdjustmentAmount) * 100) / 100;

      return {
        baseTaxEstimate,
        dynamicTaxRecommendation,
        quarterlyAdjustmentAmount,
        totalSuggestedReserve,
        recommendationStatus,
        shortfallOrSurplus,
        recommendedAdditionalReserve,
        effectiveRate,
        methodLabel,
        isDynamicEnabled,
      };
    };
  }, [actualEstimate, forecastEstimate, settings, taxPayments, taxSavings, isDynamicEnabled, isQuarterlyEnabled, quarterInfo]);

  return { getRecommendation, isLoading };
}
