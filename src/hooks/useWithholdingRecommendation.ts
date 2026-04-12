/**
 * Smart Withholding Recommendation Engine
 *
 * Calculates recommended tax withholding for a given income transaction using
 * projected annual tax model with marginal bracket logic.
 *
 * Per-entry calculation:
 * 1. Compute net taxable = gross - retirement401k - preTaxDeductions
 * 2. Apply effective annual rate to net taxable
 * 3. Add SE tax for non-W2 income
 * 4. Subtract taxes already withheld (W2 employer withholding)
 * 5. Result = additional amount to set aside
 */

import { useMemo } from "react";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { SE_TAX_RATE, SE_INCOME_FACTOR } from "@/lib/taxEngine";

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
  /** Whether using manual override mode */
  isManualMode: boolean;
  /** Whether the W2 employer over-withheld */
  isOverWithheld: boolean;
}

/**
 * Hook: returns a function to compute recommendation for a given income entry.
 *
 * Uses the full tax estimate (which already includes actual + projected income,
 * deductions, brackets, SE tax, B&O) and the effective rate to compute the
 * per-entry tax on net taxable income.
 */
export function useWithholdingRecommendation() {
  const { estimate, isLoading: estLoading } = useTaxEstimate();
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

      if (!estimate || !settings || grossIncome <= 0) return null;

      const isW2 = incomeType === "W2";

      // Net taxable income for this entry
      const netTaxableForEntry = Math.max(0, grossIncome - retirement401k - preTaxDeductions);

      // MANUAL MODE: flat rate on net taxable
      const taxMode = (settings as any).taxMode || "projected_brackets";
      const manualRate = (settings as any).manualEffectiveTaxRate;

      if (taxMode === "manual_effective_rate" && manualRate != null && manualRate > 0) {
        let taxOnEntry = netTaxableForEntry * (manualRate / 100);

        // Add SE tax for non-W2
        if (!isW2) {
          taxOnEntry += netTaxableForEntry * SE_INCOME_FACTOR * SE_TAX_RATE;
        }

        const rec = Math.round((taxOnEntry - taxesAlreadyWithheld) * 100) / 100;

        return {
          recommendedWithholding: rec,
          annualIncomeEstimate: estimate.totalIncome,
          estimatedTaxableIncome: estimate.taxableIncome,
          estimatedAnnualTax: estimate.totalTaxLiability,
          taxesAlreadyCovered: estimate.taxesAlreadyWithheld,
          estimatedRemainingTax: estimate.remainingLiability,
          effectiveRate: estimate.effectiveRate,
          isManualMode: true,
          isOverWithheld: rec < 0,
        };
      }

      // PROJECTED BRACKET MODE (default)
      // Use the effective rate from the annual estimate
      const effectiveRate = estimate.effectiveRate; // percentage

      // Tax owed on this entry's net taxable portion
      let taxOnEntry = netTaxableForEntry * (effectiveRate / 100);

      // For 1099/K1, add SE tax
      if (!isW2) {
        const seTaxPortion = netTaxableForEntry * SE_INCOME_FACTOR * SE_TAX_RATE;
        taxOnEntry += seTaxPortion;
      }

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
        effectiveRate,
        isManualMode: false,
        isOverWithheld: finalRecommendation < 0,
      };
    };
  }, [estimate, settings]);

  return { getRecommendation, isLoading };
}
