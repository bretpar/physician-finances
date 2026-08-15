/**
 * Smart Withholding Recommendation Engine
 *
 * Uses the user's global withholding method (from Settings) and centralized
 * effective-rate selection to produce a single consistent per-entry reserve
 * recommendation. It does NOT distribute annual remaining tax across future
 * paychecks.
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
import { useQuarterRecommendationInput } from "@/hooks/useQuarterRecommendationInput";
import { buildQuarterRecommendation, getActivePaymentTarget } from "@/lib/quarterRecommendation";
import {
  computeCatchUpRecommendation,
  countRemainingOpportunities,
  type CatchUpResult,
} from "@/lib/catchUpRecommendation";

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
  /** Explicit override — true forces SE tax included, false forces it excluded.
   *  Used to apply K-1 entity tax-treatment (active vs passive). */
  isSelfEmploymentTaxable?: boolean | null;
  /**
   * Employee Social Security + Medicare contained in `taxesAlreadyWithheld`.
   * FICA is NOT part of the tax target (federal income tax + SE tax + state),
   * so this amount is removed from the credit. Pass it whenever the split is
   * known; legacy callers that only have a single combined number keep the old
   * behavior.
   */
  ficaWithheldNotCredited?: number;
  /**
   * Explicit per-paycheck catch-up. When omitted, the hook uses the live
   * quarterly shortfall spread across remaining paychecks. Pass 0 to opt out.
   */
  catchUpAmount?: number;
}

export interface WithholdingRecommendation {
  /** Extra amount to save for this specific income entry, floored at 0. */
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
  recommendationBasis: "flat_rate" | "per_entry_rate";
  // ── FICA / catch-up transparency ──
  /** Employee SS+Medicare removed from the credit (never offsets income tax). */
  ficaExcludedFromCredits: number;
  /** Withholding actually credited against this entry's target. */
  creditedWithholding: number;
  /** Prospective catch-up dollars folded into this recommendation. */
  catchUpApplied: number;
  /** Quarter-level shortfall context driving the catch-up. */
  catchUp: CatchUpResult;
}

/**
 * Hook: returns a function to compute recommendation for a given income entry.
 *
 * The recommendation uses the user's global withholding method from Settings
 * and the full combined tax picture (all income sources) to compute accurate
 * per-entry withholding.
 */
export interface WithholdingRecommendationOptions {
  /** Existing transaction replaced by the current edit draft. */
  excludeTransactionId?: string | null;
}

export function useWithholdingRecommendation(options: WithholdingRecommendationOptions = {}) {
  const {
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
    actualDebug,
    currentPaceDebug,
    forecastDebug,
    isLoading: estLoading,
  } = useTaxEstimate({ excludeTransactionId: options.excludeTransactionId });
  const { data: settings, isLoading: settingsLoading } = useTaxSettings();
  const quarterInput = useQuarterRecommendationInput();

  const isLoading = estLoading || settingsLoading;

  /**
   * Live quarter shortfall spread PROSPECTIVELY across the paychecks that are
   * still ahead of the user. This is what makes recovery possible: a user who
   * fell behind now sees a slightly larger per-paycheck recommendation instead
   * of a permanently unreachable target.
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
    });
  }, [quarterInput]);

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
        isSelfEmploymentTaxable,
      } = input;

      // FICA never offsets income tax / SE tax / state tax.
      const ficaExcludedFromCredits = Math.max(0, Number(input.ficaWithheldNotCredited) || 0);
      const creditedWithholding = Math.max(
        0,
        Math.round((taxesAlreadyWithheld - ficaExcludedFromCredits) * 100) / 100,
      );
      const catchUpApplied =
        input.catchUpAmount != null
          ? Math.max(0, input.catchUpAmount)
          : Math.max(0, catchUpContext.quarterlyAdjustmentAmount);
      const catchUpFields = {
        ficaExcludedFromCredits,
        creditedWithholding,
        catchUpApplied: Math.round(catchUpApplied * 100) / 100,
        catchUp: catchUpContext,
      };

      if (!settings || grossIncome <= 0) return null;

      const isW2 = isW2FilingType(incomeType);
      const resolvedBucket = incomeBucket ?? (isW2 ? "personal" : "business");
      const withholdingMethod = settings.withholdingMethod || "dynamic_planner";
      const selectedProfile = getSelectedWithholdingProfileRate({
        taxSettings: settings,
        actualEstimate,
        currentPaceEstimate,
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
          currentPaceEstimate,
          forecastEstimate,
          companyId,
          applyBusinessStateTax,
          includeSETaxInRecommendation,
          isSelfEmploymentTaxable,
          filingStatus: (settings as any)?.filingStatus ?? undefined,
          entryGrossAmount: netTaxableForEntry,
        });
        const flatRate = rateSel.rate;
        const taxOnEntry = netTaxableForEntry * (flatRate / 100);

        const rec = Math.max(
          0,
          Math.round((taxOnEntry + catchUpApplied - creditedWithholding) * 100) / 100,
        );

        return {
          recommendedWithholding: rec,
          annualIncomeEstimate: 0,
          estimatedTaxableIncome: 0,
          estimatedAnnualTax: 0,
          taxesAlreadyCovered: 0,
          estimatedRemainingTax: 0,
          effectiveRate: flatRate,
          isManualMode: true,
          isOverWithheld: rec <= 0,
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
          ...catchUpFields,
        };
      }

      // DYNAMIC MODES: pick the selected unified estimate + debug without changing engine math
      const useForecastSource = withholdingMethod === "dynamic_planner";
      const estimate = useForecastSource ? forecastEstimate : (currentPaceEstimate ?? actualEstimate);
      const debug = useForecastSource ? forecastDebug : (currentPaceDebug ?? actualDebug);
      if (!estimate || !debug) return null;

      const methodLabel = selectedProfile.label;

      // Annual fields are kept for transparency only; they do not drive the
      // per-entry reserve recommendation.
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

      // ── W-2 path: per-entry reserve math ────────────────────────────────
      if (resolvedBucket === "personal" || isW2) {
        const rateSelection = getSavingsRateForIncomeBucket({
          incomeBucket: "personal",
          incomeType,
          taxSettings: settings,
          actualEstimate,
          currentPaceEstimate,
          forecastEstimate,
        });
        const paycheckTarget = netTaxableForEntry * (rateSelection.rate / 100);
        const recommendedWithholding = Math.max(
          0,
          Math.round((paycheckTarget + catchUpApplied - creditedWithholding) * 100) / 100,
        );

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
          ...catchUpFields,
        };
      }

      // ── 1099 / K-1 / Schedule-C path ────────────────────────────────────
      // Non-W2 income typically has no automatic withholding, so a per-entry
      // set-aside style recommendation is still appropriate. Use the blended
      // rate (federal + SE + state business) for this entry, then subtract
      // any withholding already applied to THIS paycheck. Floor at 0.
      // Edit mode supplies an estimate that already excludes the current
      // transaction, so all annual and wage-base fields share one baseline.
      const baseCurrentNetSE = Math.max(0, Number(actualEstimate?.seIncome ?? 0));
      const rateSelection = getSavingsRateForIncomeBucket({
        incomeBucket: "business",
        incomeType,
        taxSettings: settings,
        actualEstimate,
        currentPaceEstimate,
        forecastEstimate,
        companyId,
        applyBusinessStateTax,
        includeSETaxInRecommendation,
        isSelfEmploymentTaxable,
        filingStatus: (settings as any)?.filingStatus ?? undefined,
        currentW2Wages: Math.max(0, Number(actualEstimate?.w2Income ?? 0)),
        currentNetSEIncome: baseCurrentNetSE,
        entryGrossAmount: netTaxableForEntry,
      });
      const rateToUse = rateSelection.rate;
      const taxOnEntry = netTaxableForEntry * (rateToUse / 100);
      const raw = Math.round((taxOnEntry + catchUpApplied - creditedWithholding) * 100) / 100;
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
        ...catchUpFields,
      };
    };
  }, [actualEstimate, currentPaceEstimate, forecastEstimate, actualDebug, currentPaceDebug, forecastDebug, settings, catchUpContext]);

  return { getRecommendation, isLoading };
}
