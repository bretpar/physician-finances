// ============================================================================
// Tax Adjustment Pipeline — extensible staged calculation architecture
// ============================================================================
// This module DOES NOT perform tax calculations. All amounts are computed by
// `calculateFullEstimate` in taxEngine.ts (single source of truth). This layer
// re-projects those already-computed values into an ordered pipeline of
// discrete "TaxAdjustment" entries, one per stage, so:
//
//   1. Developers can inspect exactly which adjustments/credits/surtaxes were
//      applied at each stage (Gross → AGI → Taxable → Federal → Payroll →
//      Surtaxes → Credits → Final Liability → Recommended Reserve).
//   2. Future federal rules (QBI, NIIT, HSA limits, CTC refinements, EV/edu
//      credits, retirement caps, additional-Medicare refinements, etc.) can be
//      added by registering a new adjustment in `FUTURE_ADJUSTMENT_REGISTRY`
//      and (when implemented) wiring their calculation through the engine.
//      The pipeline itself does not need to change.
//   3. The Tax Validation Suite can diff stage-by-stage output against a
//      frozen baseline to detect regressions.
//
// Adding NEW rules later:
//   - Compute the amount inside taxEngine.ts (single source of truth).
//   - Register a matching TaxAdjustmentSpec so `buildTaxAdjustmentPipeline`
//     emits it in the correct stage with an explanation + source-data trail.
//   - Flip `enabled: true` on the registry entry.
// ============================================================================

import type { TaxEstimate } from "@/lib/taxEngine";

/** Ordered enum of calculation stages. Pipeline entries render in this order. */
export enum TaxStage {
  GrossIncome = "gross_income",
  BusinessProfit = "business_profit",
  AdjustmentsToIncome = "adjustments_to_income",
  AGI = "agi",
  AGIBasedAdjustments = "agi_based_adjustments",
  TaxableIncome = "taxable_income",
  FederalIncomeTax = "federal_income_tax",
  PayrollTaxes = "payroll_taxes",
  Surtaxes = "surtaxes",
  Credits = "credits",
  FinalLiability = "final_liability",
  RecommendedReserve = "recommended_reserve",
}

export const STAGE_ORDER: TaxStage[] = [
  TaxStage.GrossIncome,
  TaxStage.BusinessProfit,
  TaxStage.AdjustmentsToIncome,
  TaxStage.AGI,
  TaxStage.AGIBasedAdjustments,
  TaxStage.TaxableIncome,
  TaxStage.FederalIncomeTax,
  TaxStage.PayrollTaxes,
  TaxStage.Surtaxes,
  TaxStage.Credits,
  TaxStage.FinalLiability,
  TaxStage.RecommendedReserve,
];

export const STAGE_LABELS: Record<TaxStage, string> = {
  [TaxStage.GrossIncome]: "Gross Income",
  [TaxStage.BusinessProfit]: "Business Profit",
  [TaxStage.AdjustmentsToIncome]: "Adjustments to Income",
  [TaxStage.AGI]: "AGI",
  [TaxStage.AGIBasedAdjustments]: "AGI-Based Adjustments",
  [TaxStage.TaxableIncome]: "Taxable Income",
  [TaxStage.FederalIncomeTax]: "Federal Income Tax",
  [TaxStage.PayrollTaxes]: "Payroll Taxes",
  [TaxStage.Surtaxes]: "Surtaxes",
  [TaxStage.Credits]: "Credits",
  [TaxStage.FinalLiability]: "Final Tax Liability",
  [TaxStage.RecommendedReserve]: "Recommended Reserve / Withholding",
};

/**
 * A single discrete tax adjustment. Adjustments are stage-scoped, additive OR
 * subtractive (indicated by `sign`), and carry an explanation + source-data
 * trail for developer diagnostics.
 */
export interface TaxAdjustment {
  /** Stable unique identifier. Never rename — used by validation baselines. */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /** Stage at which this adjustment applies. */
  stage: TaxStage;
  /** False → adjustment is registered but not yet implemented (amount is 0). */
  enabled: boolean;
  /** Signed dollar amount. Positive = adds to tax/base, negative = reduces. */
  amount: number;
  /** Whether the amount adds to, subtracts from, or informs the stage total. */
  sign: "add" | "subtract" | "info";
  /** Short explanation used by developer diagnostics UI. */
  explanation: string;
  /** Named source values that fed the calculation (for audit trail). */
  sourceData: Record<string, number | string | boolean | null | undefined>;
}

/**
 * Registry of FUTURE federal rules — declared here so downstream tooling
 * (validation suite, admin UI) can enumerate them even before the underlying
 * engine calculation is wired in. Each entry ships with `enabled: false` and
 * amount 0 until the corresponding engine change lands.
 *
 * DO NOT compute tax math here. This is metadata only.
 */
export interface FutureAdjustmentSpec {
  id: string;
  displayName: string;
  stage: TaxStage;
  explanation: string;
}

export const FUTURE_ADJUSTMENT_REGISTRY: readonly FutureAdjustmentSpec[] = [
  // qbi_deduction — implemented; emitted at TaxStage.AGIBasedAdjustments
  // directly from `estimate.qbiComputation` (see buildTaxAdjustmentPipeline).
  {
    id: "niit",
    displayName: "Net Investment Income Tax (3.8%)",
    stage: TaxStage.Surtaxes,
    explanation:
      "3.8% surtax on the lesser of net investment income or MAGI over $200k single / $250k MFJ.",
  },
  {
    id: "additional_medicare_refinement",
    displayName: "Additional Medicare Tax Refinements",
    stage: TaxStage.Surtaxes,
    explanation:
      "Cross-source (W-2 + SE) reconciliation of the 0.9% Additional Medicare Tax threshold.",
  },
  {
    id: "retirement_contribution_limits",
    displayName: "Retirement Contribution Limits",
    stage: TaxStage.AdjustmentsToIncome,
    explanation:
      "Cap 401(k)/403(b)/Solo-401(k)/IRA deductions at IRS annual limits and phase-out ranges.",
  },
  {
    id: "hsa_contribution_limits",
    displayName: "HSA Contribution Limits",
    stage: TaxStage.AdjustmentsToIncome,
    explanation:
      "Cap HSA above-the-line deduction at the IRS annual limit for self-only or family coverage.",
  },
  {
    id: "child_tax_credit_refinement",
    displayName: "Child Tax Credit Refinements",
    stage: TaxStage.Credits,
    explanation:
      "Refundable / non-refundable split, ACTC, and phased earned-income requirements beyond the basic $2,000 credit.",
  },
  {
    id: "ev_tax_credit",
    displayName: "Clean Vehicle (EV) Tax Credit",
    stage: TaxStage.Credits,
    explanation:
      "Up to $7,500 for qualifying new EVs / $4,000 for used, subject to AGI limits and vehicle sourcing rules.",
  },
  {
    id: "education_credits",
    displayName: "Education Credits (AOTC / LLC)",
    stage: TaxStage.Credits,
    explanation:
      "American Opportunity or Lifetime Learning Credit, subject to MAGI phase-outs.",
  },
] as const;

// Internal helper — safe rounding for display noise.
function n(v: number | undefined | null): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return v;
}

/**
 * Project a computed TaxEstimate into an ordered adjustment pipeline. All
 * amounts come directly from the estimate — no re-computation happens here.
 */
export function buildTaxAdjustmentPipeline(estimate: TaxEstimate): TaxAdjustment[] {
  const out: TaxAdjustment[] = [];

  // ── Stage 1: Gross Income ────────────────────────────────────────────────
  out.push({
    id: "gross_w2_wages",
    displayName: "W-2 Wages",
    stage: TaxStage.GrossIncome,
    enabled: true,
    amount: n(estimate.w2Income),
    sign: "add",
    explanation: "Total W-2 wages across all employers (pre-payroll-pretax).",
    sourceData: { w2Income: n(estimate.w2Income) },
  });
  out.push({
    id: "gross_business_receipts",
    displayName: "Business Gross Receipts",
    stage: TaxStage.GrossIncome,
    enabled: true,
    amount: n(estimate.grossBusinessIncome),
    sign: "add",
    explanation: "All business gross receipts (Schedule C + K-1 + S-Corp distributions).",
    sourceData: {
      grossBusinessIncome: n(estimate.grossBusinessIncome),
      seIncome: n(estimate.seIncome),
    },
  });
  out.push({
    id: "gross_other_income",
    displayName: "Other Income",
    stage: TaxStage.GrossIncome,
    enabled: true,
    amount: n(estimate.otherIncome),
    sign: "add",
    explanation: "Non-W-2, non-business income (interest, dividends, cap gains, rental, etc.).",
    sourceData: { otherIncome: n(estimate.otherIncome) },
  });

  // ── Stage 2: Business Profit ─────────────────────────────────────────────
  out.push({
    id: "business_expenses",
    displayName: "Business Expenses",
    stage: TaxStage.BusinessProfit,
    enabled: true,
    amount: -n(estimate.businessExpenses),
    sign: "subtract",
    explanation: "Ordinary and necessary business expenses (Schedule C line 28 equivalent).",
    sourceData: { businessExpenses: n(estimate.businessExpenses) },
  });
  out.push({
    id: "mileage_deduction",
    displayName: "Mileage Deduction",
    stage: TaxStage.BusinessProfit,
    enabled: true,
    amount: -n(estimate.mileageDeduction),
    sign: "subtract",
    explanation: "Standard-mileage-rate deduction for business vehicle use.",
    sourceData: { mileageDeduction: n(estimate.mileageDeduction) },
  });
  out.push({
    id: "net_business_profit",
    displayName: "Net Business Profit",
    stage: TaxStage.BusinessProfit,
    enabled: true,
    amount: n(estimate.netBusinessProfit),
    sign: "info",
    explanation: "Gross receipts − business expenses − mileage.",
    sourceData: { netBusinessProfit: n(estimate.netBusinessProfit) },
  });

  // ── Stage 3: Adjustments to Income (above-the-line) ──────────────────────
  out.push({
    id: "w2_pretax_deductions",
    displayName: "W-2 Payroll Pre-Tax Deductions",
    stage: TaxStage.AdjustmentsToIncome,
    enabled: true,
    amount: -n(estimate.w2PreTaxDeductions),
    sign: "subtract",
    explanation: "Section 125 / 401(k) / HSA payroll pre-tax already reducing W-2 taxable wages.",
    sourceData: { w2PreTaxDeductions: n(estimate.w2PreTaxDeductions) },
  });
  out.push({
    id: "non_w2_pretax_deductions",
    displayName: "Non-W-2 Above-the-Line Deductions",
    stage: TaxStage.AdjustmentsToIncome,
    enabled: true,
    amount: -n(estimate.preTaxDeductions),
    sign: "subtract",
    explanation: "Individual/K-1 HSA contributions and similar above-the-line adjustments.",
    sourceData: { preTaxDeductions: n(estimate.preTaxDeductions) },
  });
  out.push({
    id: "retirement_contributions",
    displayName: "Retirement Contributions",
    stage: TaxStage.AdjustmentsToIncome,
    enabled: true,
    amount: -n(estimate.retirement401k),
    sign: "subtract",
    explanation: "401(k)/Solo-401(k)/SEP/traditional-IRA above-the-line contributions.",
    sourceData: { retirement401k: n(estimate.retirement401k) },
  });
  out.push({
    id: "self_employed_health_insurance",
    displayName: "Self-Employed Health Insurance",
    stage: TaxStage.AdjustmentsToIncome,
    enabled: true,
    amount: -n(estimate.healthInsuranceDeduction),
    sign: "subtract",
    explanation: "Above-the-line SE / partner / 2%+ S-Corp shareholder health-insurance premiums.",
    sourceData: { healthInsuranceDeduction: n(estimate.healthInsuranceDeduction) },
  });
  out.push({
    id: "half_se_tax_deduction",
    displayName: "One-Half of Self-Employment Tax",
    stage: TaxStage.AdjustmentsToIncome,
    enabled: true,
    amount: -n(estimate.halfSETaxDeduction),
    sign: "subtract",
    explanation: "Statutory 50% SE-tax adjustment to AGI.",
    sourceData: { halfSETaxDeduction: n(estimate.halfSETaxDeduction) },
  });

  // ── Stage 4: AGI ─────────────────────────────────────────────────────────
  out.push({
    id: "agi_total",
    displayName: "Adjusted Gross Income",
    stage: TaxStage.AGI,
    enabled: true,
    amount: n(estimate.agi),
    sign: "info",
    explanation: "Return income minus above-the-line adjustments.",
    sourceData: { agi: n(estimate.agi) },
  });

  // ── Stage 5: AGI-Based Adjustments — QBI (§199A) ─────────────────────────
  {
    const q = estimate.qbiComputation;
    out.push({
      id: "qbi_deduction",
      displayName: "Qualified Business Income Deduction (§199A)",
      stage: TaxStage.AGIBasedAdjustments,
      enabled: true,
      amount: -n(estimate.qbiDeduction),
      sign: "subtract",
      explanation:
        q.perEntity.length === 0
          ? "No eligible pass-through business income."
          : q.cappedByTaxableIncome
            ? `Capped by 20% × (taxable income − net capital gain). SSTB applicable %: ${(q.sstbApplicablePercentage * 100).toFixed(1)}%.`
            : `20% × qualified business income. SSTB applicable %: ${(q.sstbApplicablePercentage * 100).toFixed(1)}%.`,
      sourceData: {
        qbiDeduction: n(estimate.qbiDeduction),
        preliminaryTotalDeduction: n(q.preliminaryTotalDeduction),
        taxableIncomeLimit: n(q.taxableIncomeLimit),
        sstbApplicablePercentage: n(q.sstbApplicablePercentage),
        threshold: n(q.threshold),
        phaseInRange: n(q.phaseInRange),
        taxableIncomeBeforeQbi: n(q.taxableIncomeBeforeQbi),
        netCapitalGain: n(q.netCapitalGain),
        entityCount: q.perEntity.length,
        entities: q.perEntity
          .map(
            (e) =>
              `${e.input.name}${e.input.isSSTB ? " (SSTB)" : ""}: qbi=${e.input.qbi.toFixed(0)} → deduction=${e.entityDeduction.toFixed(0)}${e.fullyPhasedOut ? " (phased out)" : ""}`,
          )
          .join(" | "),
      },
    });
  }

  // ── Stage 6: Taxable Income ──────────────────────────────────────────────
  out.push({
    id: "deduction_applied",
    displayName:
      estimate.deductionType === "itemized" ? "Itemized Deduction" : "Standard Deduction",
    stage: TaxStage.TaxableIncome,
    enabled: true,
    amount: -n(estimate.deductionApplied),
    sign: "subtract",
    explanation: `${estimate.deductionType === "itemized" ? "Itemized" : "Standard"} deduction applied to reduce AGI.`,
    sourceData: {
      deductionApplied: n(estimate.deductionApplied),
      deductionType: estimate.deductionType,
      standardDeduction: n(estimate.standardDeduction),
    },
  });
  out.push({
    id: "taxable_income_total",
    displayName: "Taxable Income",
    stage: TaxStage.TaxableIncome,
    enabled: true,
    amount: n(estimate.taxableIncome),
    sign: "info",
    explanation: "AGI minus the greater of standard/itemized deduction.",
    sourceData: { taxableIncome: n(estimate.taxableIncome) },
  });

  // ── Stage 7: Federal Income Tax ──────────────────────────────────────────
  out.push({
    id: "federal_income_tax_before_credits",
    displayName: "Federal Income Tax (before credits)",
    stage: TaxStage.FederalIncomeTax,
    enabled: true,
    amount: n(estimate.federalTaxBeforeCredits),
    sign: "add",
    explanation: "Progressive-bracket ordinary tax + LTCG-bracket capital-gains tax.",
    sourceData: {
      federalTaxBeforeCredits: n(estimate.federalTaxBeforeCredits),
      marginalRate: n(estimate.marginalRate),
    },
  });

  // ── Stage 8: Payroll Taxes (SS / Medicare / SE) ──────────────────────────
  out.push({
    id: "se_social_security",
    displayName: "SE Social Security (12.4%)",
    stage: TaxStage.PayrollTaxes,
    enabled: true,
    amount: n(estimate.seTax.ssTax),
    sign: "add",
    explanation: "12.4% on SE base up to SS wage cap minus W-2 wages already covered.",
    sourceData: {
      ssTax: n(estimate.seTax.ssTax),
      seBase: n(estimate.seTax.seBase),
    },
  });
  out.push({
    id: "se_medicare",
    displayName: "SE Medicare (2.9%)",
    stage: TaxStage.PayrollTaxes,
    enabled: true,
    amount: n(estimate.seTax.medicareTax),
    sign: "add",
    explanation: "2.9% on the full SE base (no cap).",
    sourceData: { medicareTax: n(estimate.seTax.medicareTax) },
  });

  // ── Stage 9: Surtaxes (Additional Medicare + future NIIT) ────────────────
  out.push({
    id: "se_additional_medicare",
    displayName: "Additional Medicare Tax (0.9%)",
    stage: TaxStage.Surtaxes,
    enabled: true,
    amount: n(estimate.seTax.additionalMedicare),
    sign: "add",
    explanation: "0.9% on combined W-2 + SE earnings over the filing-status threshold.",
    sourceData: { additionalMedicare: n(estimate.seTax.additionalMedicare) },
  });
  for (const spec of FUTURE_ADJUSTMENT_REGISTRY.filter(
    (s) => s.stage === TaxStage.Surtaxes,
  )) {
    out.push({
      id: spec.id,
      displayName: spec.displayName,
      stage: spec.stage,
      enabled: false,
      amount: 0,
      sign: "add",
      explanation: `[Not implemented] ${spec.explanation}`,
      sourceData: {},
    });
  }

  // ── Stage 10: Credits ────────────────────────────────────────────────────
  out.push({
    id: "dependent_credits",
    displayName: "Child + Other Dependent Credits",
    stage: TaxStage.Credits,
    enabled: true,
    amount: -n(estimate.taxCredits),
    sign: "subtract",
    explanation: "CTC ($2,000/child) + ODC ($500/other dependent) with high-income phase-out.",
    sourceData: { taxCredits: n(estimate.taxCredits) },
  });
  for (const spec of FUTURE_ADJUSTMENT_REGISTRY.filter(
    (s) => s.stage === TaxStage.Credits,
  )) {
    out.push({
      id: spec.id,
      displayName: spec.displayName,
      stage: spec.stage,
      enabled: false,
      amount: 0,
      sign: "subtract",
      explanation: `[Not implemented] ${spec.explanation}`,
      sourceData: {},
    });
  }

  // Future adjustments-to-income specs (retirement/HSA limits) declared last
  // so the main stage stays uncluttered but they're still enumerable.
  for (const spec of FUTURE_ADJUSTMENT_REGISTRY.filter(
    (s) => s.stage === TaxStage.AdjustmentsToIncome,
  )) {
    out.push({
      id: spec.id,
      displayName: spec.displayName,
      stage: spec.stage,
      enabled: false,
      amount: 0,
      sign: "subtract",
      explanation: `[Not implemented] ${spec.explanation}`,
      sourceData: {},
    });
  }

  // ── Stage 11: Final Tax Liability ────────────────────────────────────────
  out.push({
    id: "state_tax_personal",
    displayName: "State Income Tax (Personal)",
    stage: TaxStage.FinalLiability,
    enabled: true,
    amount: n(estimate.personalStateTax),
    sign: "add",
    explanation: "Personal state income tax net of state withholding.",
    sourceData: { personalStateTax: n(estimate.personalStateTax) },
  });
  out.push({
    id: "state_tax_business",
    displayName: "State Income / B&O Tax (Business)",
    stage: TaxStage.FinalLiability,
    enabled: true,
    amount: n(estimate.businessStateTax),
    sign: "add",
    explanation: "Business state tax (rate × eligible base) net of business state withholding.",
    sourceData: { businessStateTax: n(estimate.businessStateTax) },
  });
  out.push({
    id: "total_tax_liability",
    displayName: "Total Tax Liability",
    stage: TaxStage.FinalLiability,
    enabled: true,
    amount: n(estimate.totalTaxLiability),
    sign: "info",
    explanation: "Federal income tax + SE tax + state tax.",
    sourceData: {
      totalTaxLiability: n(estimate.totalTaxLiability),
      federalWithheld: n(estimate.federalWithheld),
      stateWithheld: n(estimate.stateWithheld),
      remainingLiability: n(estimate.remainingLiability),
    },
  });

  // ── Stage 12: Recommended Reserve / Withholding ──────────────────────────
  out.push({
    id: "recommended_set_aside",
    displayName: "Recommended Per-Paycheck Set-Aside",
    stage: TaxStage.RecommendedReserve,
    enabled: true,
    amount: n(estimate.recommendedSetAside),
    sign: "info",
    explanation: "Remaining liability ÷ remaining pay periods.",
    sourceData: {
      recommendedSetAside: n(estimate.recommendedSetAside),
      targetSetAside: n(estimate.targetSetAside),
      quarterlyEstimate: n(estimate.quarterlyEstimate),
    },
  });

  return out;
}

/** Group adjustments by stage in canonical order — used by diagnostics UI. */
export function groupPipelineByStage(
  adjustments: TaxAdjustment[],
): { stage: TaxStage; label: string; items: TaxAdjustment[] }[] {
  const byStage = new Map<TaxStage, TaxAdjustment[]>();
  for (const a of adjustments) {
    const list = byStage.get(a.stage) ?? [];
    list.push(a);
    byStage.set(a.stage, list);
  }
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    items: byStage.get(stage) ?? [],
  })).filter((g) => g.items.length > 0);
}
