import { describe, it, expect } from "vitest";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";

/**
 * HSA classification regression tests.
 *
 * Verifies the engine correctly splits HSA contributions into:
 *   • W-2 payroll pre-tax (Section 125) — reduces W-2 taxable income.
 *   • Non-W-2 above-the-line (K-1, 1099, manual individual HSA) — reduces AGI
 *     but does NOT reduce SE-tax base.
 */

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
    ssWageCap: 168_600,
    includeProjectedIncome: false,
    businessNonW2HsaAboveLine: 0,
    personalNonW2HsaAboveLine: 0,
    ...overrides,
  };
}

describe("HSA classification", () => {
  it("A) W-2 user with $100k W-2 + $4k payroll HSA reduces W-2 taxable base by $4k", () => {
    const noHsa = computeUnifiedTaxEstimate(baseInput({
      personalIncome: 100_000,
      personalW2: 100_000,
    }));
    const withHsa = computeUnifiedTaxEstimate(baseInput({
      personalIncome: 100_000,
      personalW2: 100_000,
      personalPreTax: 4_000, // W-2 payroll HSA goes through personalPreTax
    }));

    expect(noHsa.debug.w2TaxableIncomeBase).toBe(100_000);
    expect(withHsa.debug.w2TaxableIncomeBase).toBe(96_000);
    expect(withHsa.debug.w2PreTaxDeductions).toBe(4_000);
    expect(withHsa.debug.nonW2HsaAboveLineDeduction).toBe(0);
  });

  it("B) K-1-only user with $100k K-1 + $4k HSA: AGI drops by $4k, SE tax unchanged", () => {
    const noHsa = computeUnifiedTaxEstimate(baseInput({
      businessIncome: 100_000,
      seEligibleBusinessIncome: 100_000,
    }));
    const withHsa = computeUnifiedTaxEstimate(baseInput({
      businessIncome: 100_000,
      seEligibleBusinessIncome: 100_000,
      businessNonW2HsaAboveLine: 4_000,
    }));

    // SE tax base must NOT be reduced by HSA
    expect(withHsa.estimate.seTax.total).toBeCloseTo(noHsa.estimate.seTax.total, 2);

    // AGI drops by exactly $4k
    expect(noHsa.estimate.agi - withHsa.estimate.agi).toBeCloseTo(4_000, 2);

    // Debug labels
    expect(withHsa.debug.nonW2HsaAboveLineDeduction).toBe(4_000);
    expect(withHsa.debug.w2PreTaxDeductions).toBe(0);
  });

  it("C) Mixed W-2 + K-1 + manual HSA: HSA reduces AGI, not SE tax, not W-2 payroll pre-tax", () => {
    const noHsa = computeUnifiedTaxEstimate(baseInput({
      personalIncome: 50_000,
      personalW2: 50_000,
      businessIncome: 100_000,
      seEligibleBusinessIncome: 100_000,
    }));
    const withHsa = computeUnifiedTaxEstimate(baseInput({
      personalIncome: 50_000,
      personalW2: 50_000,
      businessIncome: 100_000,
      seEligibleBusinessIncome: 100_000,
      personalNonW2HsaAboveLine: 4_000, // manual individual HSA
    }));

    // SE tax unchanged
    expect(withHsa.estimate.seTax.total).toBeCloseTo(noHsa.estimate.seTax.total, 2);
    // W-2 payroll pre-tax bucket NOT used
    expect(withHsa.debug.w2PreTaxDeductions).toBe(0);
    // W-2 taxable base unchanged
    expect(withHsa.debug.w2TaxableIncomeBase).toBe(noHsa.debug.w2TaxableIncomeBase);
    // AGI down by $4k
    expect(noHsa.estimate.agi - withHsa.estimate.agi).toBeCloseTo(4_000, 2);
    expect(withHsa.debug.nonW2HsaAboveLineDeduction).toBe(4_000);
  });

  it("D) Manual individual HSA still reduces AGI even with $0 W-2 income", () => {
    const noHsa = computeUnifiedTaxEstimate(baseInput({
      businessIncome: 80_000,
      seEligibleBusinessIncome: 80_000,
    }));
    const withHsa = computeUnifiedTaxEstimate(baseInput({
      businessIncome: 80_000,
      seEligibleBusinessIncome: 80_000,
      personalNonW2HsaAboveLine: 4_000,
    }));

    expect(noHsa.estimate.w2Income).toBe(0);
    expect(noHsa.estimate.agi - withHsa.estimate.agi).toBeCloseTo(4_000, 2);
    expect(withHsa.debug.nonW2HsaAboveLineDeduction).toBe(4_000);
  });
});
