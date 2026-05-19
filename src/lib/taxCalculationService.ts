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
  // ── Actual (YTD) numbers ──
  /** All non-W2 business gross receipts (Schedule C + K-1 + S-Corp distributions). */
  businessIncome: number;
  /** Subset of businessIncome that is true SE earnings (Schedule C + K-1 partnership). */
  seEligibleBusinessIncome: number;
  seEligibleBusinessExpenses?: number;
  seEligibleMileageDeduction?: number;
  businessW2: number;
  /** Federal withholding actually withheld from business/1099 income to date. */
  businessFederalWithheld: number;
  /** State withholding actually withheld from business/1099 income to date. */
  businessStateWithheld: number;
  businessPreTax: number;
  /**
   * HSA contributions tied to non-W-2 business (K-1 partnership, 1099 / Schedule C,
   * S-Corp distributions). These are above-the-line AGI adjustments — NOT W-2 Section
   * 125 payroll pre-tax — and must NOT reduce the SE-tax base.
   */
  businessNonW2HsaAboveLine?: number;
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
  /** Federal withholding actually withheld from personal income to date. */
  personalFederalWithheld: number;
  /** State withholding actually withheld from personal income to date. */
  personalStateWithheld: number;
  personalPreTax: number;
  /**
   * HSA contributions that are individual / non-W-2 (manual HSA contributions,
   * or HSA contributions on non-W-2 personal income entries). Above-the-line.
   */
  personalNonW2HsaAboveLine?: number;
  personalRetirement: number;
  netStockGain: number;
  /**
   * Long-term capital gains + qualified dividends (gain side, floored at 0).
   * Routed through AGI like other income but taxed at LTCG brackets in the engine,
   * stacked on top of ordinary taxable income.
   */
  longTermCapitalGains?: number;
  businessExpenses: number;
  mileageDeduction: number;
  annualizedRetirement: number;
  /** User-set-aside reserves on transactions (informational — NOT a submitted tax payment). */
  txActualWithholding: number;
  /** Quarterly estimated tax payments actually submitted to the IRS/state. */
  actualEstimatedPaymentsMade: number;
  /** Money set aside in a savings bucket (informational — NOT a submitted tax payment). */
  taxSavingsSetAside: number;
  remainingPayPeriods: number;

  // ── Projected future numbers (only used when includeProjectedIncome=true) ──
  /** Future projected W-2 paychecks gross. */
  projectedW2Income: number;
  /** Future projected SE income (Schedule C / K-1) gross. */
  projectedSEIncome: number;
  /** Future projected non-SE other income (S-Corp distributions, etc.) gross. */
  projectedOtherIncome: number;
  /** Future federal withholding expected from projected W-2 paychecks. */
  projectedFederalWithheld: number;
  /** Future state withholding expected from projected W-2 paychecks. */
  projectedStateWithheld: number;
  projectedPreTax: number;
  projectedRetirement: number;
  /** Future projected health insurance deduction from projected streams. */
  projectedHealthInsuranceDeduction: number;

  // ── Settings ──
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
  withholdingMethod?: string | null;
  manualEffectiveTaxRate?: number | null;
  rateSourceLabel?: string | null;

  stateIncomeTaxEnabled?: boolean;
  /** Backwards-compatible alias for personal state income tax only. */
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
  filingStatus: "single" | "married_filing_jointly";
  actualIncome: number;
  projectedIncome: number;
  totalGrossIncome: number;
  // ── IRS-style flow ──
  grossBusinessIncome: number;
  businessExpenses: number;
  netBusinessProfit: number;
  w2Income: number;
  w2PreTaxDeductions: number;
  w2TaxableIncomeBase: number;
  otherIncome: number;
  totalReturnIncomeBeforeAdjustments: number;
  /** Non-W-2 pre-tax deductions only; W-2 pre-tax is reflected in w2TaxableIncomeBase. */
  preTaxDeductions: number;
  deductionSourceBreakdown: string;
  retirementContributions: number;
  /** Self-employed / partner / employee health insurance deduction (separate from pre-tax). */
  healthInsuranceDeduction: number;
  /** Actual (YTD) portion of healthInsuranceDeduction. */
  actualHealthInsuranceDeduction: number;
  /** Projected future portion (only when includeProjectedIncome=true). */
  projectedHealthInsuranceDeduction: number;
  halfSETaxDeduction: number;
  ownerDeductions: number;
  /** Adjusted Gross Income = return income after W-2 payroll deductions − non-W2 preTax − retirement − health insurance − ½ SE tax. */
  agi: number;
  deductionApplied: number;
  deductionType: "standard" | "itemized";
  totalTaxableIncome: number;
  // ── Tax math ──
  federalIncomeTax: number;
  selfEmploymentTax: number;
  stateTax: number;
  totalEstimatedTax: number;
  canonicalEffectiveTaxRate: number;
  taxOverviewRateSource: string;
  advancedBreakdownRateSource: string;
  personalRecommendationsRateSource: string;
  businessRecommendationsRateSource: string;
  flatManualWithholdingActive: boolean;
  estimatedAnnualTax: number;     // alias of totalEstimatedTax
  federalTaxBeforeCredits: number;
  taxCredits: number;
  // ── Credits against tax (explicit) ──
  /** Federal withholding already paid on actual income to date. */
  actualFederalWithheld: number;
  /** State withholding already paid on actual income to date. */
  actualStateWithheld: number;
  /** Future federal withholding from projected W-2 paychecks (only when includeProjectedIncome). */
  projectedFederalWithheld: number;
  /** Future state withholding from projected W-2 paychecks (only when includeProjectedIncome). */
  projectedStateWithheld: number;
  /** Quarterly estimated payments actually submitted. */
  estimatedPaymentsMade: number;
  /** Tax savings set aside in a bucket — informational only, NOT counted. */
  taxSavingsSetAside: number;
  /** Total counted credits = actual fed + actual state + projected fed + projected state + estimated payments. */
  countedCreditsTotal: number;
  /** Total NOT counted = tax savings + tx reserves (informational only). */
  nonCountedSavingsTotal: number;
  /** Remaining tax due after counted credits. */
  remainingTaxDue: number;
  // ── Back-compat aliases ──
  taxesAlreadyWithheldOrPaid: number; // = countedCreditsTotal
  taxesAlreadyWithheld: number;       // = actualFederalWithheld + projectedFederalWithheld
  federalWithheld: number;            // = actualFederalWithheld + projectedFederalWithheld
  stateWithheld: number;              // = actualStateWithheld + projectedStateWithheld
  personalStateTax: number;
  businessStateTax: number;
  taxReserves: number;                // tx-level set-aside (not counted)
  quarterlyPayments: number;          // = estimatedPaymentsMade
  taxSavings: number;                 // = taxSavingsSetAside
  additionalTaxPaid: number;          // = estimatedPaymentsMade (NO LONGER includes savings)
  remainingTaxToCover: number;        // = remainingTaxDue
  remainingEstimatedTax: number;      // = remainingTaxDue
  recommendedSetAside: number;
  targetSetAside: number;
  withholdingOverrideType: "none" | "percent" | "amount";
  totalDeductions: number;
}

/* ─── Main function ─── */

export function computeUnifiedTaxEstimate(input: UnifiedTaxInput): UnifiedTaxResult {
  const {
    businessIncome, seEligibleBusinessIncome,
    seEligibleBusinessExpenses: seEligibleBusinessExpensesParam,
    seEligibleMileageDeduction: seEligibleMileageDeductionParam,
    businessW2,
    businessFederalWithheld, businessStateWithheld,
    businessPreTax, businessRetirement,
    businessNonW2HsaAboveLine = 0,
    ownerHealthcare,
    businessStateEligibleGross, businessStateEligibleExpenses,
    businessStateEligibleMileage, businessStateEligibleOwnerAdjustments,
    personalIncome, personalW2, personalNonW2Income,
    personalFederalWithheld, personalStateWithheld,
    personalPreTax, personalRetirement,
    personalNonW2HsaAboveLine = 0,
    netStockGain, longTermCapitalGains: longTermCapitalGainsParam = 0,
    businessExpenses, mileageDeduction, annualizedRetirement,
    txActualWithholding,
    actualEstimatedPaymentsMade,
    taxSavingsSetAside,
    remainingPayPeriods,
    projectedW2Income, projectedSEIncome, projectedOtherIncome,
    projectedFederalWithheld, projectedStateWithheld,
    projectedPreTax, projectedRetirement, projectedHealthInsuranceDeduction,
    filingStatus, lastYearTax, standardDeductionOverride, ssWageCap,
    deductionType = "standard",
    itemizedDeductionAmount = 0,
    qualifyingChildrenCount = 0,
    otherDependentsCount = 0,
    withholdingOverrideType = "none",
    withholdingOverridePercent = null,
    withholdingOverrideAmount = null,
    withholdingMethod = "dynamic_actual",
    manualEffectiveTaxRate = null,
    stateIncomeTaxEnabled,
    stateTaxEnabled = false,
    personalStateTaxMode = "none",
    personalStateTaxRate = 0,
    personalStateTaxAnnualEstimate = 0,
    businessStateTaxEnabled = false,
    businessStateTaxRate = 0,
    businessStateTaxBase = "net_profit",
    includeProjectedIncome,
  } = input;

  // Floor LTCG slice at zero — losses already netted upstream.
  const longTermCapitalGains = Math.max(0, longTermCapitalGainsParam);

  // ── Actual income ──
  const actualIncome = businessIncome + businessW2 + personalIncome + netStockGain + longTermCapitalGains;
  const seEligibleBusinessExpenses = seEligibleBusinessExpensesParam ?? businessExpenses;
  const seEligibleMileageDeduction = seEligibleMileageDeductionParam ?? mileageDeduction;

  // ── Projected additions, classified by tax bucket ──
  const projW2 = includeProjectedIncome ? projectedW2Income : 0;
  const projSE = includeProjectedIncome ? projectedSEIncome : 0;
  const projOther = includeProjectedIncome ? projectedOtherIncome : 0;
  const projIncome = projW2 + projSE + projOther;

  const projFedWH = includeProjectedIncome ? projectedFederalWithheld : 0;
  const projStateWH = includeProjectedIncome ? projectedStateWithheld : 0;
  const projPreTax = includeProjectedIncome ? projectedPreTax : 0;
  const projRetirement = includeProjectedIncome ? projectedRetirement : 0;
  // Projected healthcare must ONLY appear in forecast mode — never leak into Actual Only.
  const projHealthInsurance = includeProjectedIncome ? projectedHealthInsuranceDeduction : 0;

  // ── Totals ──
  const totalIncome = actualIncome + projIncome;

  // W-2 line includes future projected W-2 only.
  const w2Income = businessW2 + personalW2 + projW2;

  // True SE income for SE tax (actual + projected SE).
  const seIncome = seEligibleBusinessIncome + projSE;

  // Display: ALL business gross (actual + projected SE + projected other-business).
  const grossBusinessIncome = businessIncome + projSE + projOther;

  // Other income = personal non-W2 + stock/ordinary investment + LTCG slice + ineligible actual business + projected other.
  // The LTCG slice flows through AGI here; the engine separates it out at the federal-tax step
  // so it gets taxed at long-term capital gains brackets instead of ordinary brackets.
  const ineligibleBusinessIncome = Math.max(0, businessIncome - seEligibleBusinessIncome);
  const otherIncome = personalNonW2Income + netStockGain + longTermCapitalGains + ineligibleBusinessIncome + projOther;

  // combinedPreTax = ONLY W-2 payroll pre-tax deductions (NOT health insurance, NOT HSA from K-1/1099/individual).
  // healthInsuranceDeduction is tracked separately so the breakdown UI can label it explicitly.
  // Non-W-2 / individual / K-1 HSA contributions flow through `nonW2HsaAboveLineDeduction`
  // into `preTaxDeductions` (above-the-line AGI adjustment) and must NEVER reduce SE-taxable income.
  const combinedPreTax = businessPreTax + personalPreTax + projPreTax;
  const w2PreTaxDeductions = businessPreTax + personalPreTax + projPreTax;
  const w2TaxableIncomeBase = Math.max(0, w2Income - w2PreTaxDeductions);
  const nonW2HsaAboveLineDeduction = Math.max(0, businessNonW2HsaAboveLine) + Math.max(0, personalNonW2HsaAboveLine);
  const nonW2PreTaxDeductions = nonW2HsaAboveLineDeduction;
  const actualHealthInsuranceDeduction = ownerHealthcare;
  const healthInsuranceDeduction = actualHealthInsuranceDeduction + projHealthInsurance;
  const combined401k = businessRetirement + personalRetirement + annualizedRetirement + projRetirement;
  const personalStateTaxableIncome = Math.max(0, personalW2 + personalNonW2Income + projW2 - personalPreTax - personalRetirement - projPreTax - projRetirement);

  // ── Credits against tax (explicit) ──
  const actualFederalWithheld = businessFederalWithheld + personalFederalWithheld;
  const actualStateWithheld = businessStateWithheld + personalStateWithheld;
  const combinedFederalWithheld = actualFederalWithheld + projFedWH;
  const combinedStateWithheld = actualStateWithheld + projStateWH;

  // additionalTaxPaid = ONLY actual estimated payments. Savings are NOT counted.
  const additionalTaxPaid = actualEstimatedPaymentsMade;

  const stateTaxInputs: StateTaxInputs = {
    stateIncomeTaxEnabled: stateIncomeTaxEnabled ?? stateTaxEnabled,
    personalStateTaxMode,
    personalStateTaxRate,
    personalStateTaxAnnualEstimate,
    personalStateTaxableIncome,
    personalStateWithheld: actualStateWithheld + projStateWH,
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
    seBusinessDeductions: seEligibleBusinessExpenses,
    seMileageDeduction: seEligibleMileageDeduction,
    grossBusinessIncome,
    otherIncome,
    w2PreTaxDeductions,
    preTaxDeductions: nonW2PreTaxDeductions,
    retirement401k: combined401k,
    healthInsuranceDeduction,
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
    longTermCapitalGains,
    stateTaxInputs,
  });

  const totalDeductions =
    w2PreTaxDeductions + nonW2PreTaxDeductions + combined401k + healthInsuranceDeduction + businessExpenses + mileageDeduction +
    estimate.deductionApplied + estimate.seTax.deductibleHalf;

  // Counted credits = federal + state withholding + estimated payments.
  // (State withholding offsets state tax inside the engine; we surface the gross
  // here so users see the full picture of money already applied to their bill.)
  const countedCreditsTotal =
    combinedFederalWithheld + combinedStateWithheld + actualEstimatedPaymentsMade;
  const nonCountedSavingsTotal = taxSavingsSetAside + txActualWithholding;
  // Remaining = totalEstimatedTax − countedCreditsTotal. We compute this here
  // (instead of using estimate.remainingLiability) so the identity always
  // holds and state withholding never gets "double-counted" by being implicit
  // in state tax due AND added to countedCreditsTotal.
  const remainingTaxDue = Math.max(0, estimate.totalTaxLiability - countedCreditsTotal);
  const scopeLabel = input.rateSourceLabel || (includeProjectedIncome ? "actual + planned" : "actual only");

  const debug: TaxDebugBreakdown = {
    includeProjectedIncome,
    filingStatus,
    actualIncome,
    projectedIncome: projIncome,
    totalGrossIncome: totalIncome,
    grossBusinessIncome: estimate.grossBusinessIncome,
    businessExpenses: estimate.businessExpenses,
    netBusinessProfit: estimate.netBusinessProfit,
    w2Income: estimate.w2Income,
    w2PreTaxDeductions,
    w2TaxableIncomeBase,
    otherIncome: estimate.otherIncome,
    totalReturnIncomeBeforeAdjustments: estimate.totalReturnIncomeBeforeAdjustments,
    preTaxDeductions: nonW2PreTaxDeductions,
    deductionSourceBreakdown: `W-2 payroll pre-tax: ${w2PreTaxDeductions.toFixed(2)}; non-W-2 pre-tax: ${nonW2PreTaxDeductions.toFixed(2)}; retirement: ${combined401k.toFixed(2)}; health insurance: ${healthInsuranceDeduction.toFixed(2)}; half SE tax: ${estimate.halfSETaxDeduction.toFixed(2)}`,
    retirementContributions: combined401k,
    healthInsuranceDeduction,
    actualHealthInsuranceDeduction,
    projectedHealthInsuranceDeduction: projHealthInsurance,
    halfSETaxDeduction: estimate.halfSETaxDeduction,
    ownerDeductions: ownerHealthcare + businessRetirement + businessPreTax,
    agi: estimate.agi,
    deductionApplied: estimate.deductionApplied,
    deductionType: estimate.deductionType,
    totalTaxableIncome: estimate.taxableIncome,
    federalIncomeTax: estimate.federalTax,
    selfEmploymentTax: estimate.seTax.total,
    stateTax: estimate.stateTax,
    totalEstimatedTax: estimate.totalTaxLiability,
    canonicalEffectiveTaxRate: estimate.effectiveRate,
    taxOverviewRateSource: withholdingMethod === "flat_estimate" ? `Flat/manual ${manualEffectiveTaxRate ?? 0}%` : `Canonical ${scopeLabel} total estimated tax ÷ total return income`,
    advancedBreakdownRateSource: withholdingMethod === "flat_estimate" ? `Flat/manual ${manualEffectiveTaxRate ?? 0}%` : `Canonical ${scopeLabel} total estimated tax ÷ total return income`,
    personalRecommendationsRateSource: withholdingMethod === "flat_estimate" ? `Flat/manual ${manualEffectiveTaxRate ?? 0}%` : `Canonical ${scopeLabel} effective rate`,
    businessRecommendationsRateSource: withholdingMethod === "flat_estimate" ? `Flat/manual ${manualEffectiveTaxRate ?? 0}% + business add-ons` : `Canonical ${scopeLabel} federal rate + SE/pass-through + business tax add-ons`,
    flatManualWithholdingActive: withholdingMethod === "flat_estimate",
    estimatedAnnualTax: estimate.totalTaxLiability,
    federalTaxBeforeCredits: estimate.federalTaxBeforeCredits,
    taxCredits: estimate.taxCredits,
    // Explicit credits
    actualFederalWithheld,
    actualStateWithheld,
    projectedFederalWithheld: projFedWH,
    projectedStateWithheld: projStateWH,
    estimatedPaymentsMade: actualEstimatedPaymentsMade,
    taxSavingsSetAside,
    countedCreditsTotal,
    nonCountedSavingsTotal,
    remainingTaxDue,
    // Back-compat aliases
    taxesAlreadyWithheldOrPaid: countedCreditsTotal,
    taxesAlreadyWithheld: combinedFederalWithheld,
    federalWithheld: combinedFederalWithheld,
    stateWithheld: combinedStateWithheld,
    personalStateTax: estimate.personalStateTax,
    businessStateTax: estimate.businessStateTax,
    taxReserves: txActualWithholding,
    quarterlyPayments: actualEstimatedPaymentsMade,
    taxSavings: taxSavingsSetAside,
    additionalTaxPaid,
    remainingTaxToCover: remainingTaxDue,
    remainingEstimatedTax: remainingTaxDue,
    recommendedSetAside: estimate.recommendedSetAside,
    targetSetAside: estimate.targetSetAside,
    withholdingOverrideType,
    totalDeductions,
  };

  return { estimate, debug };
}
