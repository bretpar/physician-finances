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
import { type SavingsRateResult } from "@/lib/savingsRateSelection";
import { computeCanonicalEventRecommendation } from "@/lib/canonicalEventRecommendation";
import type { EventTaxTarget } from "@/lib/taxAllocation";
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
  /**
   * False for historical / already-received events. Historical events keep
   * their event tax target but never receive future catch-up dollars.
   */
  isFutureOpportunity?: boolean;
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
  // ── Canonical allocation transparency ──
  /** This event's share of the canonical annual liability (before coverage). */
  eventTaxTarget: number;
  /** Component split of that share (federal / state / SE / business state). */
  allocatedEventTax: EventTaxTarget;
  /** True when a W-2 deficit is delivered via the annual W-4 instead of savings. */
  fundedByAnnualW4: boolean;
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

      if (!settings || grossIncome <= 0) return null;

      const isW2 = isW2FilingType(incomeType);
      const resolvedBucket = incomeBucket ?? (isW2 ? "personal" : "business");
      const withholdingMethod = settings.withholdingMethod || "dynamic_planner";
      const isFlat = withholdingMethod === "flat_estimate";

      // ONE annual estimate + ONE debug source, selected by the user's method.
      const useForecastSource = withholdingMethod === "dynamic_planner";
      const estimate = isFlat
        ? (forecastEstimate ?? currentPaceEstimate ?? actualEstimate)
        : useForecastSource
          ? forecastEstimate
          : (currentPaceEstimate ?? actualEstimate);
      const debug = isFlat
        ? (forecastDebug ?? currentPaceDebug ?? actualDebug)
        : useForecastSource
          ? forecastDebug
          : (currentPaceDebug ?? actualDebug);
      if (!isFlat && (!estimate || !debug)) return null;

      // Annual transparency fields — never a second liability.
      const annualTaxLiability = Number(estimate?.totalTaxLiability ?? 0);
      const countedCreditsTotal = Number(debug?.countedCreditsTotal ?? 0);
      const annualRemainingTax = Number(debug?.remainingTaxDue ?? 0);

      const requestedCatchUp =
        input.catchUpAmount != null
          ? Math.max(0, input.catchUpAmount)
          : Math.max(0, catchUpContext.quarterlyAdjustmentAmount);

      const canonical = computeCanonicalEventRecommendation({
        estimate,
        taxSettings: settings,
        incomeType,
        incomeBucket: resolvedBucket,
        grossIncome,
        retirement401k,
        preTaxDeductions,
        companyId,
        applyBusinessStateTax,
        includeSETaxInRecommendation,
        isSelfEmploymentTaxable,
        filingStatus: (settings as any)?.filingStatus ?? undefined,
        creditedWithholding,
        catchUpAmount: requestedCatchUp,
        isFutureOpportunity: input.isFutureOpportunity,
        annualRemainingTax: isFlat ? undefined : annualRemainingTax,
        w2FundingMethod: (settings as any)?.w2PaycheckRecMethod ?? "annual_w4",
        forceFlatRatePct: isFlat ? undefined : null,
      });
      if (!canonical) return null;

      const catchUpFields = {
        ficaExcludedFromCredits,
        creditedWithholding,
        catchUpApplied: canonical.catchUpApplied,
        catchUp: catchUpContext,
      };

      return {
        recommendedWithholding: canonical.recommendedWithholding,
        annualIncomeEstimate:
          Number(estimate?.totalIncome ?? 0) + (alreadyIncludedInEstimate ? 0 : grossIncome),
        estimatedTaxableIncome: Number(estimate?.taxableIncome ?? 0),
        estimatedAnnualTax: annualTaxLiability,
        taxesAlreadyCovered: countedCreditsTotal,
        estimatedRemainingTax: annualRemainingTax,
        effectiveRate: canonical.rateBreakdown.rate,
        isManualMode: canonical.basis === "flat_rate",
        isOverWithheld: canonical.signedRecommendation <= 0,
        methodLabel: canonical.methodLabel,
        rateBreakdown: canonical.rateBreakdown,
        annualTaxLiability,
        countedCreditsTotal,
        annualRemainingTax,
        projectedFederalWithheld: Number(debug?.projectedFederalWithheld ?? 0),
        projectedStateWithheld: Number(debug?.projectedStateWithheld ?? 0),
        actualFederalWithheld: Number(debug?.actualFederalWithheld ?? 0),
        actualStateWithheld: Number(debug?.actualStateWithheld ?? 0),
        estimatedPaymentsMade: Number(debug?.estimatedPaymentsMade ?? 0),
        taxSavingsSetAside: Number(debug?.taxSavingsSetAside ?? 0),
        recommendationBasis: canonical.basis === "flat_rate" ? "flat_rate" : "per_entry_rate",
        eventTaxTarget: canonical.eventTaxTarget,
        allocatedEventTax: canonical.target,
        fundedByAnnualW4: canonical.fundedByAnnualW4,
        ...catchUpFields,
      };
    };
  }, [actualEstimate, currentPaceEstimate, forecastEstimate, actualDebug, currentPaceDebug, forecastDebug, settings, catchUpContext]);

  return { getRecommendation, isLoading };
}
