/**
 * Smart Withholding Recommendation Engine
 *
 * Uses the user's global withholding method (from Settings) and the UNIFIED
 * tax estimate (actual + projected W-2 withholding + estimated payments) to
 * produce a single consistent per-entry recommendation.
 *
 * Key fix (Apr 2026): W-2 recommendations now respect projected future W-2
 * withholding already expected across the year. Previously we applied the
 * effective rate to each paycheck and subtracted only that paycheck's own
 * withholding — which double-counted tax that employer payroll will already
 * withhold on remaining checks. We now distribute only the UNIFIED
 * remaining-after-credits annual tax across remaining pay periods.
 *
 * Methods:
 * - flat_estimate: user-defined flat % on net taxable (legacy per-entry)
 * - dynamic_actual: bracket-based using actual income only
 * - dynamic_planner: bracket-based using actual + projected income (and
 *   projected future W-2 withholding as a counted credit)
 */

import { useMemo } from "react";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { isW2FilingType } from "@/lib/filingTypes";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate, type SavingsRateResult } from "@/lib/savingsRateSelection";

export interface WithholdingInput {
  grossIncome: number;
  incomeType: string; // 'W2' | '1099' | 'K1'
  incomeBucket?: "personal" | "business";
  taxesAlreadyWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
  alreadyIncludedInEstimate?: boolean;
  companyId?: string | null;
  applyBusinessStateTax?: boolean | null;
  includeSETaxInRecommendation?: boolean | null;
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
  /** Total counted credits (fed W/H + state W/H + projected W/H + estimated payments) */
  taxesAlreadyCovered: number;
  /** Remaining estimated tax for the year AFTER all counted credits */
  estimatedRemainingTax: number;
  /** Effective tax rate on total income */
  effectiveRate: number;
  /** Whether using flat rate mode */
  isManualMode: boolean;
  /** Whether the entry is over-withheld / fully covered */
  isOverWithheld: boolean;
  /** Label describing which method is used */
  methodLabel: string;
  rateBreakdown?: SavingsRateResult;
  // ── Transparency fields (see spec §6) ──
  annualTaxLiability: number;
  countedCreditsTotal: number;
  annualRemainingTax: number;
  projectedFederalWithheld: number;
  projectedStateWithheld: number;
  actualFederalWithheld: number;
  actualStateWithheld: number;
  estimatedPaymentsMade: number;
  taxSavingsSetAside: number;
  recommendationBasis: "annual_remaining_tax" | "flat_rate" | "per_entry_rate";
}

/**
 * Hook: returns a function to compute recommendation for a given income entry.
 *
 * The recommendation uses the user's global withholding method from Settings
 * and the full combined tax picture (all income sources) to compute accurate
 * per-entry withholding.
 */
export function useWithholdingRecommendation() {
  const {
    actualEstimate,
    forecastEstimate,
    actualDebug,
    forecastDebug,
    isLoading: estLoading,
  } = useTaxEstimate();
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();

  const isLoading = estLoading || settingsLoading;

  const getRecommendation = useMemo(() => {
    return (input: WithholdingInput): WithholdingRecommendation | null => {
      const {
        grossIncome,
        incomeType,
        incomeBucket,
        taxesAlreadyWithheld,
        retirement401k,
        preTaxDeductions,
        alreadyIncludedInEstimate = false,
        companyId,
        applyBusinessStateTax,
        includeSETaxInRecommendation,
      } = input;

      if (!settings || grossIncome <= 0) return null;

      const isW2 = isW2FilingType(incomeType);
      const resolvedBucket = incomeBucket ?? (isW2 ? "personal" : "business");
      const withholdingMethod = settings.withholdingMethod || "dynamic_planner";
      const selectedProfile = getSelectedWithholdingProfileRate({
        taxSettings: settings,
        actualEstimate,
        forecastEstimate,
      });

      // Net taxable income for this entry
      const netTaxableForEntry = Math.max(0, grossIncome - retirement401k - preTaxDeductions);

      // FLAT ESTIMATE MODE
      if (withholdingMethod === "flat_estimate") {
        const rateSel = getSavingsRateForIncomeBucket({
          incomeBucket: resolvedBucket,
          incomeType,
          taxSettings: settings,
          actualEstimate,
          forecastEstimate,
          companyId,
          applyBusinessStateTax,
          includeSETaxInRecommendation,
        });
        const flatRate = rateSel.rate;
        const taxOnEntry = netTaxableForEntry * (flatRate / 100);

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
          methodLabel: rateSel.label,
          rateBreakdown: rateSel,
          annualTaxLiability: 0,
          countedCreditsTotal: 0,
          annualRemainingTax: 0,
          projectedFederalWithheld: 0,
          projectedStateWithheld: 0,
          actualFederalWithheld: 0,
          actualStateWithheld: 0,
          estimatedPaymentsMade: 0,
          taxSavingsSetAside: 0,
          recommendationBasis: "flat_rate",
        };
      }

      // DYNAMIC MODES: pick the selected unified estimate + debug without changing engine math
      const useForecastSource = withholdingMethod === "dynamic_planner";
      const estimate = useForecastSource ? forecastEstimate : actualEstimate;
      const debug = useForecastSource ? forecastDebug : actualDebug;
      if (!estimate || !debug) return null;

      const methodLabel = selectedProfile.label;

      // ── Unified "annual remaining tax" view ─────────────────────────────
      // debug.countedCreditsTotal already includes:
      //   - actual federal withholding
      //   - actual state withholding
      //   - projected federal withholding (planner mode only)
      //   - projected state withholding (planner mode only)
      //   - estimated payments actually made
      // It explicitly does NOT include tax savings / reserves.
      const annualTaxLiability = estimate.totalTaxLiability;
      const countedCreditsTotal = debug.countedCreditsTotal;
      const annualRemainingTax = debug.remainingTaxDue; // = max(0, liability − credits)

      // ── W-2 path: annual-remaining-tax distribution ─────────────────────
      if (resolvedBucket === "personal" || isW2) {
        const rateSelection = getSavingsRateForIncomeBucket({
          incomeBucket: "personal",
          incomeType,
          taxSettings: settings,
          actualEstimate,
          forecastEstimate,
        });
        const paycheckTarget = netTaxableForEntry * (rateSelection.rate / 100);
        const recommendedWithholding = Math.round((paycheckTarget - taxesAlreadyWithheld) * 100) / 100;

        return {
          recommendedWithholding,
          annualIncomeEstimate: estimate.totalIncome + (alreadyIncludedInEstimate ? 0 : grossIncome),
          estimatedTaxableIncome: estimate.taxableIncome,
          estimatedAnnualTax: annualTaxLiability,
          taxesAlreadyCovered: countedCreditsTotal,
          estimatedRemainingTax: annualRemainingTax,
          effectiveRate: rateSelection.rate,
          isManualMode: false,
          isOverWithheld: recommendedWithholding <= 0,
          methodLabel,
          rateBreakdown: rateSelection,
          annualTaxLiability,
          countedCreditsTotal,
          annualRemainingTax,
          projectedFederalWithheld: debug.projectedFederalWithheld,
          projectedStateWithheld: debug.projectedStateWithheld,
          actualFederalWithheld: debug.actualFederalWithheld,
          actualStateWithheld: debug.actualStateWithheld,
          estimatedPaymentsMade: debug.estimatedPaymentsMade,
          taxSavingsSetAside: debug.taxSavingsSetAside,
          recommendationBasis: "per_entry_rate",
        };
      }

      // ── 1099 / K-1 / Schedule-C path ────────────────────────────────────
      // Non-W2 income typically has no automatic withholding, so a per-entry
      // set-aside style recommendation is still appropriate. Use the blended
      // rate (federal + SE + state business) for this entry, then subtract
      // any withholding already applied to THIS paycheck. Floor at 0.
      const rateSelection = getSavingsRateForIncomeBucket({
        incomeBucket: "business",
        incomeType,
        taxSettings: settings,
        actualEstimate,
        forecastEstimate,
        companyId,
        applyBusinessStateTax,
        includeSETaxInRecommendation,
      });
      const rateToUse = rateSelection.rate;
      const taxOnEntry = netTaxableForEntry * (rateToUse / 100);
      const raw = Math.round((taxOnEntry - taxesAlreadyWithheld) * 100) / 100;
      const recommendedWithholding = Math.max(0, raw);

      return {
        recommendedWithholding,
        annualIncomeEstimate: estimate.totalIncome + (alreadyIncludedInEstimate ? 0 : grossIncome),
        estimatedTaxableIncome: estimate.taxableIncome,
        estimatedAnnualTax: annualTaxLiability,
        taxesAlreadyCovered: countedCreditsTotal,
        estimatedRemainingTax: annualRemainingTax,
        effectiveRate: rateToUse,
        isManualMode: false,
        isOverWithheld: false,
        methodLabel,
        rateBreakdown: rateSelection,
        annualTaxLiability,
        countedCreditsTotal,
        annualRemainingTax,
        projectedFederalWithheld: debug.projectedFederalWithheld,
        projectedStateWithheld: debug.projectedStateWithheld,
        actualFederalWithheld: debug.actualFederalWithheld,
        actualStateWithheld: debug.actualStateWithheld,
        estimatedPaymentsMade: debug.estimatedPaymentsMade,
        taxSavingsSetAside: debug.taxSavingsSetAside,
        recommendationBasis: "per_entry_rate",
      };
    };
  }, [actualEstimate, forecastEstimate, actualDebug, forecastDebug, settings]);

  return { getRecommendation, isLoading };
}
