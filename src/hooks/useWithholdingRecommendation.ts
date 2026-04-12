/**
 * Smart Withholding Recommendation Engine
 *
 * Calculates recommended tax withholding for a given income transaction using
 * projected annual tax model with marginal bracket logic.
 *
 * FLOW:
 * 1. Estimate annual income = actual YTD + projected remaining
 * 2. Apply deductions (pre-tax, retirement, business, mileage, standard deduction)
 * 3. Calculate federal tax via progressive brackets
 * 4. Add SE tax + B&O tax
 * 5. Subtract taxes already withheld/paid
 * 6. Allocate remaining tax proportionally to this income entry
 */

import { useMemo } from "react";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";

export interface WithholdingRecommendation {
  /** Amount to withhold/set aside for this specific income entry */
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
}

/**
 * Hook: returns a function to compute recommendation for a given income amount.
 *
 * Uses the full tax estimate (which already includes actual + projected income,
 * deductions, brackets, SE tax, B&O) and proportionally allocates the remaining
 * tax burden to the current income entry.
 */
export function useWithholdingRecommendation() {
  const { estimate, isLoading: estLoading } = useTaxEstimate();
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();

  const isLoading = estLoading || settingsLoading;

  /**
   * Get recommendation for a specific income amount.
   *
   * @param incomeAmount - Gross income for this transaction
   * @param alreadyIncludedInEstimate - Whether this amount is already in the
   *   YTD totals (true for editing existing entries, false for new entries)
   */
  const getRecommendation = useMemo(() => {
    return (incomeAmount: number, alreadyIncludedInEstimate = false): WithholdingRecommendation | null => {
      if (!estimate || !settings || incomeAmount <= 0) return null;

      // MANUAL MODE: simple flat rate
      const taxMode = (settings as any).taxMode || "projected_brackets";
      const manualRate = (settings as any).manualEffectiveTaxRate;

      if (taxMode === "manual_effective_rate" && manualRate != null && manualRate > 0) {
        const rec = Math.round(incomeAmount * (manualRate / 100) * 100) / 100;
        return {
          recommendedWithholding: rec,
          annualIncomeEstimate: estimate.totalIncome,
          estimatedTaxableIncome: estimate.taxableIncome,
          estimatedAnnualTax: estimate.totalTaxLiability,
          taxesAlreadyCovered: estimate.taxesAlreadyWithheld,
          estimatedRemainingTax: estimate.remainingLiability,
          effectiveRate: estimate.effectiveRate,
          isManualMode: true,
        };
      }

      // PROJECTED BRACKET MODE (default)
      // Step 6: Remaining tax after what's already covered
      const estimatedRemainingTax = estimate.remainingLiability;

      // Step 7: Determine remaining income base for proportional allocation
      // The estimate already includes projected future income.
      // We use the total annual estimate minus what's been received as the
      // "remaining income base" that this entry is part of.
      const actualYTD = estimate.w2Income + estimate.seIncome;
      // If this income is already in the estimate (editing), don't double-count
      const adjustedActual = alreadyIncludedInEstimate ? actualYTD : actualYTD + incomeAmount;
      const remainingIncomeBase = Math.max(incomeAmount, estimate.totalIncome - adjustedActual + incomeAmount);

      // Step 8: Proportional allocation
      // recommended = remaining_tax × (this_income / remaining_income_base)
      let recommendedWithholding = 0;
      if (remainingIncomeBase > 0 && estimatedRemainingTax > 0) {
        recommendedWithholding = Math.round(
          (estimatedRemainingTax * (incomeAmount / remainingIncomeBase)) * 100
        ) / 100;
      }

      // Safety: never recommend more than the income amount itself
      recommendedWithholding = Math.min(recommendedWithholding, incomeAmount);

      return {
        recommendedWithholding: Math.max(0, recommendedWithholding),
        annualIncomeEstimate: estimate.totalIncome + (alreadyIncludedInEstimate ? 0 : incomeAmount),
        estimatedTaxableIncome: estimate.taxableIncome,
        estimatedAnnualTax: estimate.totalTaxLiability,
        taxesAlreadyCovered: estimate.taxesAlreadyWithheld,
        estimatedRemainingTax,
        effectiveRate: estimate.effectiveRate,
        isManualMode: false,
      };
    };
  }, [estimate, settings]);

  return { getRecommendation, isLoading };
}
