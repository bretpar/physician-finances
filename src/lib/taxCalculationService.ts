/**
 * Centralized Tax Calculation Service
 *
 * Single source of truth for tax estimates used by both the Taxes tab
 * and the Income Planner.  Call `computeUnifiedTaxEstimate` with the
 * same raw data and `includeProjectedIncome` flag to get identical results.
 */

import {
  calculateFullEstimate,
  type TaxEstimate,
  type StateTaxInputs,
} from "@/lib/taxEngine";

/* ─── Input types ─── */

export interface UnifiedTaxInput {
  // Actual (YTD) numbers
  /** All non-W2 business gross receipts (Schedule C + K-1 + S-Corp distributions). */
  businessIncome: number;
  /** Subset of businessIncome that is true SE earnings (Schedule C + K-1 partnership). */
  seEligibleBusinessIncome: number;
  businessW2: number;
  businessFederalWithheld: number;
  businessStateWithheld: number;
  businessPreTax: number;
  businessRetirement: number;
  ownerHealthcare: number;
  businessStateEligibleGross: number;
  businessStateEligibleExpenses: number;
  businessStateEligibleMileage: number;
  businessStateEligibleOwnerAdjustments: number;
  /** Total personal income (W2 + ordinary + capgains + rental − losses). */
  personalIncome: number;
  personalW2: number;
  /** Personal taxable income that is NOT W-2 (ordinary, cap gains, rental, etc.) — used as "other income" on the return. */
  personalNonW2Income: number;
  personalFederalWithheld: number;
  personalStateWithheld: number;
  personalPreTax: number;
  personalRetirement: number;
  netStockGain: number;
  businessExpenses: number;
  mileageDeduction: number;
  annualizedRetirement: number;
  txActualWithholding: number;
  quarterlyPaid: number;
  savingsTotal: number;
  remainingPayPeriods: number;

  // Projected future numbers (only used when includeProjectedIncome=true)
  projectedGrossIncome: number;
  projectedTaxesWithheld: number;
  projectedPreTax: number;
  projectedRetirement: number;

  // Settings
  filingStatus: "single" | "married_filing_jointly";
  lastYearTax: number;
  standardDeductionOverride?: number | null;
  ssWageCap: number;
  deductionType?: "standard" | "itemized";
  itemizedDeductionAmount?: number;
  qualifyingChildrenCount?: number;
  otherDependentsCount?: number;
  withholdingOverrideType?: "none" | "percent" | "amount";
  withholdingOverridePercent?: number | null;
  withholdingOverrideAmount?: number | null;

  stateTaxEnabled?: boolean;
  personalStateTaxMode?: "none" | "flat_rate" | "annual_estimate";
  personalStateTaxRate?: number;
  personalStateTaxAnnualEstimate?: number;
  businessStateTaxEnabled?: boolean;
  businessStateTaxRate?: number;
  businessStateTaxBase?: "net_profit" | "gross";

  includeProjectedIncome: boolean;
}

export interface UnifiedTaxResult {
  estimate: TaxEstimate;

  // Breakdown for debug / transparency
  debug: TaxDebugBreakdown;
}

export interface TaxDebugBreakdown {
  includeProjectedIncome: boolean;
  actualIncome: number;
  projectedIncome: number;
  totalGrossIncome: number;
  totalDeductions: number;
  ownerDeductions: number;        // K-1 owner healthcare + retirement + pre-tax (reduces taxable income, not profit)
  businessExpenses: number;       // Ordinary operating expenses (reduces business profit)
  preTaxDeductions: number;       // 401k + health/HSA + other pre-tax
  deductionApplied: number;       // Standard or itemized actually applied
  deductionType: "standard" | "itemized";
  totalTaxableIncome: number;
  estimatedAnnualTax: number;
  federalTaxBeforeCredits: number;
  taxCredits: number;             // CTC + ODC after phase-out
  taxesAlreadyWithheld: number;   // Federal-only
  federalWithheld: number;
  stateWithheld: number;
  personalStateTax: number;
  businessStateTax: number;
  taxReserves: number;           // actual_withholding — recommendation, not paid
  quarterlyPayments: number;
  taxSavings: number;
  additionalTaxPaid: number;     // quarterly + savings (NOT reserves)
  remainingEstimatedTax: number;
  recommendedSetAside: number;
  targetSetAside: number;        // After optional withholding override
  withholdingOverrideType: "none" | "percent" | "amount";
}

/* ─── Main function ─── */

export function computeUnifiedTaxEstimate(input: UnifiedTaxInput): UnifiedTaxResult {
  const {
    businessIncome, businessW2,
    businessFederalWithheld, businessStateWithheld,
    businessPreTax, businessRetirement,
    ownerHealthcare,
    businessStateEligibleGross, businessStateEligibleExpenses,
    businessStateEligibleMileage, businessStateEligibleOwnerAdjustments,
    personalIncome, personalW2,
    personalFederalWithheld, personalStateWithheld,
    personalPreTax, personalRetirement,
    netStockGain, businessExpenses, mileageDeduction, annualizedRetirement,
    txActualWithholding, quarterlyPaid, savingsTotal, remainingPayPeriods,
    projectedGrossIncome, projectedTaxesWithheld, projectedPreTax, projectedRetirement,
    filingStatus, lastYearTax, standardDeductionOverride, ssWageCap,
    deductionType = "standard",
    itemizedDeductionAmount = 0,
    qualifyingChildrenCount = 0,
    otherDependentsCount = 0,
    withholdingOverrideType = "none",
    withholdingOverridePercent = null,
    withholdingOverrideAmount = null,
    stateTaxEnabled = false,
    personalStateTaxMode = "none",
    personalStateTaxRate = 0,
    personalStateTaxAnnualEstimate = 0,
    businessStateTaxEnabled = false,
    businessStateTaxRate = 0,
    businessStateTaxBase = "net_profit",
    includeProjectedIncome,
  } = input;

  // ── Actual income ──
  const actualIncome = businessIncome + businessW2 + personalIncome + netStockGain;

  // ── Projected additions ──
  const projIncome = includeProjectedIncome ? projectedGrossIncome : 0;
  const projWithheld = includeProjectedIncome ? projectedTaxesWithheld : 0;
  const projPreTax = includeProjectedIncome ? projectedPreTax : 0;
  const projRetirement = includeProjectedIncome ? projectedRetirement : 0;

  // ── Totals ──
  const totalIncome = actualIncome + projIncome;
  const w2Income = businessW2 + personalW2; // For SS wage cap
  const seIncome = businessIncome;

  const combinedPreTax = businessPreTax + personalPreTax + projPreTax + ownerHealthcare;
  const combined401k = businessRetirement + personalRetirement + annualizedRetirement + projRetirement;

  // FEDERAL withholding only (state isolated)
  const combinedFederalWithheld = businessFederalWithheld + personalFederalWithheld + projWithheld;
  const combinedStateWithheld = businessStateWithheld + personalStateWithheld;
  const additionalTaxPaid = quarterlyPaid + savingsTotal;

  // Split state withholding into business vs personal pots for the engine
  const stateTaxInputs: StateTaxInputs = {
    stateTaxEnabled,
    personalStateTaxMode,
    personalStateTaxRate,
    personalStateTaxAnnualEstimate,
    personalStateWithheld,
    businessStateTaxEnabled,
    businessStateTaxRate,
    businessStateTaxBase,
    eligibleBusinessGross: businessStateEligibleGross,
    eligibleBusinessExpenses: businessStateEligibleExpenses,
    eligibleBusinessMileage: businessStateEligibleMileage,
    eligibleBusinessOwnerAdjustments: businessStateEligibleOwnerAdjustments,
    businessStateWithheld,
  };

  const estimate = calculateFullEstimate({
    totalIncome,
    w2Income,
    seIncome,
    preTaxDeductions: combinedPreTax,
    retirement401k: combined401k,
    businessDeductions: businessExpenses,
    mileageDeduction,
    taxesWithheld: combinedFederalWithheld,
    filingStatus,
    lastYearTax,
    standardDeductionOverride,
    ssWageCap,
    remainingPayPeriods,
    additionalTaxPaid,
    deductionType,
    itemizedDeductionAmount,
    qualifyingChildrenCount,
    otherDependentsCount,
    withholdingOverrideType,
    withholdingOverridePercent,
    withholdingOverrideAmount,
    stateTaxInputs,
  });

  const totalDeductions = combinedPreTax + combined401k + businessExpenses + mileageDeduction + estimate.deductionApplied + estimate.seTax.deductibleHalf;

  const debug: TaxDebugBreakdown = {
    includeProjectedIncome,
    actualIncome,
    projectedIncome: projIncome,
    totalGrossIncome: totalIncome,
    totalDeductions,
    ownerDeductions: ownerHealthcare + businessRetirement + businessPreTax,
    businessExpenses,
    preTaxDeductions: combinedPreTax,
    deductionApplied: estimate.deductionApplied,
    deductionType: estimate.deductionType,
    totalTaxableIncome: estimate.taxableIncome,
    estimatedAnnualTax: estimate.totalTaxLiability,
    federalTaxBeforeCredits: estimate.federalTaxBeforeCredits,
    taxCredits: estimate.taxCredits,
    taxesAlreadyWithheld: combinedFederalWithheld,
    federalWithheld: combinedFederalWithheld,
    stateWithheld: combinedStateWithheld,
    personalStateTax: estimate.personalStateTax,
    businessStateTax: estimate.businessStateTax,
    taxReserves: txActualWithholding,
    quarterlyPayments: quarterlyPaid,
    taxSavings: savingsTotal,
    additionalTaxPaid,
    remainingEstimatedTax: estimate.remainingLiability,
    recommendedSetAside: estimate.recommendedSetAside,
    targetSetAside: estimate.targetSetAside,
    withholdingOverrideType,
  };

  return { estimate, debug };
}
