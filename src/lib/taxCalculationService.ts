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
} from "@/lib/taxEngine";

/* ─── Input types ─── */

export interface UnifiedTaxInput {
  // Actual (YTD) numbers
  businessIncome: number;       // 1099/K1 gross
  businessW2: number;           // W2 gross from business income entries
  businessWithheld: number;     // Employer withholding on business income
  businessPreTax: number;       // Pre-tax deductions on business income
  businessRetirement: number;   // Retirement contributions on business income
  ownerHealthcare: number;      // K-1 owner healthcare premiums (reduces taxable income, not profit)
  personalIncome: number;       // Total personal income (W2+ordinary+capgains+rental-losses)
  personalW2: number;           // W2 portion of personal income
  personalWithheld: number;     // Employer withholding on personal income
  personalPreTax: number;
  personalRetirement: number;
  netStockGain: number;
  businessExpenses: number;     // Ordinary operating expenses (reduce business profit)
  mileageDeduction: number;
  annualizedRetirement: number; // From retirement_contributions table
  txActualWithholding: number;  // User reserves (NOT taxes paid)
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
  bnoRate: number;              // Already as decimal (e.g. 0.015)

  // Mode
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
  totalTaxableIncome: number;
  estimatedAnnualTax: number;
  taxesAlreadyWithheld: number;
  taxReserves: number;           // actual_withholding — recommendation, not paid
  quarterlyPayments: number;
  taxSavings: number;
  additionalTaxPaid: number;     // quarterly + savings (NOT reserves)
  remainingEstimatedTax: number;
  recommendedSetAside: number;
}

/* ─── Main function ─── */

export function computeUnifiedTaxEstimate(input: UnifiedTaxInput): UnifiedTaxResult {
  const {
    businessIncome, businessW2, businessWithheld, businessPreTax, businessRetirement,
    ownerHealthcare,
    personalIncome, personalW2, personalWithheld, personalPreTax, personalRetirement,
    netStockGain, businessExpenses, mileageDeduction, annualizedRetirement,
    txActualWithholding, quarterlyPaid, savingsTotal, remainingPayPeriods,
    projectedGrossIncome, projectedTaxesWithheld, projectedPreTax, projectedRetirement,
    filingStatus, lastYearTax, standardDeductionOverride, ssWageCap, bnoRate,
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

  // Owner deductions (healthcare, retirement, pre-tax) reduce TAXABLE INCOME, not business profit
  // They flow through preTaxDeductions and retirement401k to the tax engine
  const combinedPreTax = businessPreTax + personalPreTax + projPreTax + ownerHealthcare;
  const combined401k = businessRetirement + personalRetirement + annualizedRetirement + projRetirement;

  // Taxes already withheld = employer withholding only
  // txActualWithholding is a RESERVE — routes to additionalTaxPaid alongside quarterly+savings
  const combinedWithheld = businessWithheld + personalWithheld + projWithheld;
  const additionalTaxPaid = quarterlyPaid + savingsTotal;

  const estimate = calculateFullEstimate({
    totalIncome,
    w2Income,
    seIncome,
    preTaxDeductions: combinedPreTax,
    retirement401k: combined401k,
    businessDeductions: businessExpenses,
    mileageDeduction,
    taxesWithheld: combinedWithheld,
    filingStatus,
    lastYearTax,
    standardDeductionOverride,
    ssWageCap,
    bnoRate,
    remainingPayPeriods,
    additionalTaxPaid,
  });

  const totalDeductions = combinedPreTax + combined401k + businessExpenses + mileageDeduction + estimate.standardDeduction + estimate.seTax.deductibleHalf;

  const debug: TaxDebugBreakdown = {
    includeProjectedIncome,
    actualIncome,
    projectedIncome: projIncome,
    totalGrossIncome: totalIncome,
    totalDeductions,
    ownerDeductions: ownerHealthcare + businessRetirement + businessPreTax,
    businessExpenses,
    totalTaxableIncome: estimate.taxableIncome,
    estimatedAnnualTax: estimate.totalTaxLiability,
    taxesAlreadyWithheld: combinedWithheld,
    taxReserves: txActualWithholding,
    quarterlyPayments: quarterlyPaid,
    taxSavings: savingsTotal,
    additionalTaxPaid,
    remainingEstimatedTax: estimate.remainingLiability,
    recommendedSetAside: estimate.recommendedSetAside,
  };

  return { estimate, debug };
}
