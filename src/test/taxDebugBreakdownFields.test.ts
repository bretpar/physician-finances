import { describe, it, expect } from "vitest";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";

function baseInput(overrides: Partial<UnifiedTaxInput> = {}): UnifiedTaxInput {
  return {
    businessIncome: 0,
    seEligibleBusinessIncome: 0,
    businessW2: 0,
    businessFederalWithheld: 0,
    businessStateWithheld: 0,
    businessPreTax: 0,
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
    personalRetirement: 0,
    netStockGain: 0,
    businessExpenses: 0,
    mileageDeduction: 0,
    annualizedRetirement: 0,
    txActualWithholding: 0,
    actualEstimatedPaymentsMade: 0,
    taxSavingsSetAside: 0,
    remainingPayPeriods: 12,
    projectedW2Income: 0,
    projectedSEIncome: 0,
    projectedOtherIncome: 0,
    projectedFederalWithheld: 0,
    projectedStateWithheld: 0,
    projectedPreTax: 0,
    projectedRetirement: 0,
    projectedHealthInsuranceDeduction: 0,
    filingStatus: "single",
    lastYearTax: 0,
    ssWageCap: 168600,
    includeProjectedIncome: false,
    ...overrides,
  };
}

describe("TaxDebugBreakdown SE-tax fields", () => {
  it("exposes ss/medicare/addlMedicare/seBase that reconcile to selfEmploymentTax", () => {
    const { estimate, debug } = computeUnifiedTaxEstimate(baseInput({
      businessIncome: 250_000,
      seEligibleBusinessIncome: 250_000,
      personalIncome: 0,
    }));
    // Fields exist and match the underlying engine values.
    expect(debug.seSocialSecurityTax).toBe(estimate.seTax.ssTax);
    expect(debug.seMedicareTax).toBe(estimate.seTax.medicareTax);
    expect(debug.seAdditionalMedicareTax).toBe(estimate.seTax.additionalMedicare);
    expect(debug.seTaxableBase).toBe(estimate.seTax.seBase);
    // Sum ties out to the reported SE tax total.
    const sum =
      debug.seSocialSecurityTax + debug.seMedicareTax + debug.seAdditionalMedicareTax;
    expect(Math.abs(sum - debug.selfEmploymentTax)).toBeLessThan(0.01);
  });

  it("is zero across all SE-tax fields when there is no SE income", () => {
    const { debug } = computeUnifiedTaxEstimate(baseInput({
      personalIncome: 120_000,
      personalW2: 120_000,
    }));
    expect(debug.seSocialSecurityTax).toBe(0);
    expect(debug.seMedicareTax).toBe(0);
    expect(debug.seAdditionalMedicareTax).toBe(0);
    expect(debug.seTaxableBase).toBe(0);
    expect(debug.selfEmploymentTax).toBe(0);
  });
});
