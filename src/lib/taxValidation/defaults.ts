// ============================================================================
// Tax Validation Suite — default scenario input
// ============================================================================
// A canonical "zero" UnifiedTaxInput. Scenarios spread over this so each
// scenario file only needs to specify the fields that make it unique.
// ============================================================================

import type { UnifiedTaxInput } from "@/lib/taxCalculationService";
import { SS_WAGE_BASE } from "@/lib/taxBrackets";

export const DEFAULT_INPUT: UnifiedTaxInput = {
  // ── Actual (YTD) numbers ──
  businessIncome: 0,
  seEligibleBusinessIncome: 0,
  seEligibleBusinessExpenses: 0,
  seEligibleMileageDeduction: 0,
  businessW2: 0,
  businessFederalWithheld: 0,
  businessStateWithheld: 0,
  businessPreTax: 0,
  businessNonW2HsaAboveLine: 0,
  businessRetirement: 0,
  ownerHealthcare: 0,
  businessStateEligibleGross: 0,
  businessStateEligibleExpenses: 0,
  businessStateEligibleMileage: 0,
  businessStateEligibleOwnerAdjustments: 0,
  personalIncome: 0,
  personalW2: 0,
  personalNonW2Income: 0,
  personalFederalWithheld: 0,
  personalStateWithheld: 0,
  personalPreTax: 0,
  personalNonW2HsaAboveLine: 0,
  personalRetirement: 0,
  netStockGain: 0,
  longTermCapitalGains: 0,
  businessExpenses: 0,
  mileageDeduction: 0,
  annualizedRetirement: 0,
  txActualWithholding: 0,
  actualEstimatedPaymentsMade: 0,
  taxSavingsSetAside: 0,
  remainingPayPeriods: 26,

  // ── Projected ──
  projectedW2Income: 0,
  projectedSEIncome: 0,
  projectedOtherIncome: 0,
  projectedFederalWithheld: 0,
  projectedStateWithheld: 0,
  projectedPreTax: 0,
  projectedRetirement: 0,
  projectedHealthInsuranceDeduction: 0,

  // ── Settings ──
  filingStatus: "single",
  lastYearTax: 0,
  ssWageCap: SS_WAGE_BASE,
  deductionType: "standard",
  itemizedDeductionAmount: 0,
  qualifyingChildrenCount: 0,
  otherDependentsCount: 0,
  withholdingOverrideType: "none",
  stateIncomeTaxEnabled: false,
  stateTaxEnabled: false,
  personalStateTaxMode: "none",
  personalStateTaxRate: 0,
  personalStateTaxAnnualEstimate: 0,
  businessStateTaxEnabled: false,
  businessStateTaxRate: 0,
  businessStateTaxBase: "net_profit",
  includeProjectedIncome: false,
};

export function makeInput(overrides: Partial<UnifiedTaxInput>): UnifiedTaxInput {
  return { ...DEFAULT_INPUT, ...overrides };
}
