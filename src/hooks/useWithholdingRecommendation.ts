/**
 * Smart Withholding Recommendation Engine
 *
 * Uses the user's global withholding method (from Settings) and combined
 * total income across all sections (business + personal + stocks + projected)
 * to produce a single consistent recommendation.
 *
 * Methods:
 * - flat_estimate: user-defined flat % on net taxable
 * - dynamic_actual: bracket-based using actual income only
 * - dynamic_planner: bracket-based using actual + projected income
 */

import { useMemo } from "react";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { SE_TAX_RATE, SE_INCOME_FACTOR } from "@/lib/taxEngine";
import { isW2FilingType, isSelfEmployedFilingType } from "@/lib/filingTypes";

export interface WithholdingInput {
  grossIncome: number;
  incomeType: string; // 'W2' | '1099' | 'K1'
  taxesAlreadyWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
  alreadyIncludedInEstimate?: boolean;
}

export interface WithholdingRecommendation {
  /** Amount to withhold/set aside for this specific income entry (can be negative for W2) */
  recommendedWithholding: number;
  /** Projected total annual income */
  annualIncomeEstimate: number;
  /** Taxable income after deductions */
  estimatedTaxableIncome: number;
  /** Total estimated annual tax liability */
  estimatedAnnualTax: number;
  /** Total taxes already covered (withheld + quarterly + savings) */
  taxesAlreadyCovered: number;
  /** Remaining estimated tax for the year */
  estimatedRemainingTax: number;
  /** Effective tax rate on total income */
  effectiveRate: number;
  /** Whether using flat rate mode */
  isManualMode: boolean;
  /** Whether the W2 employer over-withheld */
  isOverWithheld: boolean;
  /** Label describing which method is used */
  methodLabel: string;
}

/**
 * Hook: returns a function to compute recommendation for a given income entry.
 *
 * The recommendation uses the user's global withholding method from Settings
 * and the full combined tax picture (all income sources) to compute accurate
 * per-entry withholding.
 */
export function useWithholdingRecommendation() {
  const { actualEstimate, forecastEstimate, isLoading: estLoading } = useTaxEstimate();
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();

  const isLoading = estLoading || settingsLoading;

  const getRecommendation = useMemo(() => {
    return (input: WithholdingInput): WithholdingRecommendation | null => {
      const {
        grossIncome,
        incomeType,
        taxesAlreadyWithheld,
        retirement401k,
        preTaxDeductions,
        alreadyIncludedInEstimate = false,
      } = input;

      if (!settings || grossIncome <= 0) return null;

      const isW2 = isW2FilingType(incomeType);
      const isSelfEmployed = isSelfEmployedFilingType(incomeType);
      const withholdingMethod = settings.withholdingMethod || "dynamic_actual";

      // Net taxable income for this entry
      const netTaxableForEntry = Math.max(0, grossIncome - retirement401k - preTaxDeductions);

      // FLAT ESTIMATE MODE
      if (withholdingMethod === "flat_estimate") {
        const flatRate = settings.manualEffectiveTaxRate ?? 20;
        let taxOnEntry = netTaxableForEntry * (flatRate / 100);

        // Add SE tax only for true self-employed (1099/K-1, NOT S-Corp distributions)
        if (isSelfEmployed) {
          taxOnEntry += netTaxableForEntry * SE_INCOME_FACTOR * SE_TAX_RATE;
        }

        const rec = Math.round((taxOnEntry - taxesAlreadyWithheld) * 100) / 100;

        return {
          recommendedWithholding: rec,
          annualIncomeEstimate: 0,
          estimatedTaxableIncome: 0,
          estimatedAnnualTax: 0,
          taxesAlreadyCovered: 0,
          estimatedRemainingTax: 0,
          effectiveRate: flatRate,
          isManualMode: true,
          isOverWithheld: rec < 0,
          methodLabel: `Flat ${flatRate}% estimate`,
        };
      }

      // DYNAMIC MODES: pick the right estimate
      const estimate = withholdingMethod === "dynamic_planner" ? forecastEstimate : actualEstimate;
      if (!estimate) return null;

      const methodLabel = withholdingMethod === "dynamic_planner"
        ? "Based on actual + planned income"
        : "Based on combined actual income";

      // W2: use federal-only rate (SE + B&O don't apply to W2 income)
      // 1099/K1: use blended rate (already includes federal + SE + B&O)
      const rateToUse = isW2 ? estimate.federalEffectiveRate : estimate.effectiveRate;

      // Tax owed on this entry's net taxable portion
      const taxOnEntry = netTaxableForEntry * (rateToUse / 100);

      // Subtract what's already withheld for this specific paycheck
      const recommendedWithholding = Math.round((taxOnEntry - taxesAlreadyWithheld) * 100) / 100;

      // For 1099/K1, floor at 0 (they don't have employer withholding to adjust)
      // For W2, allow negative to indicate over-withholding
      const finalRecommendation = isW2
        ? recommendedWithholding
        : Math.max(0, recommendedWithholding);

      return {
        recommendedWithholding: finalRecommendation,
        annualIncomeEstimate: estimate.totalIncome + (alreadyIncludedInEstimate ? 0 : grossIncome),
        estimatedTaxableIncome: estimate.taxableIncome,
        estimatedAnnualTax: estimate.totalTaxLiability,
        taxesAlreadyCovered: estimate.taxesAlreadyWithheld,
        estimatedRemainingTax: estimate.remainingLiability,
        effectiveRate: rateToUse,
        isManualMode: false,
        isOverWithheld: finalRecommendation < 0,
        methodLabel,
      };
    };
  }, [actualEstimate, forecastEstimate, settings]);

  return { getRecommendation, isLoading };
}
