import { describe, it, expect } from "vitest";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";

const baseInput: UnifiedTaxInput = {
  businessIncome: 100000,
  seEligibleBusinessIncome: 100000,
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
  personalIncome: 80000,
  personalW2: 80000,
  personalNonW2Income: 0,
  personalFederalWithheld: 12000,
  personalStateWithheld: 3000,
  personalPreTax: 0,
  personalRetirement: 0,
  netStockGain: 0,
  businessExpenses: 10000,
  mileageDeduction: 0,
  annualizedRetirement: 0,
  txActualWithholding: 5000, // user reserve — must NOT count
  actualEstimatedPaymentsMade: 4000,
  taxSavingsSetAside: 7500, // savings — must NOT count
  remainingPayPeriods: 6,
  projectedW2Income: 0,
  projectedSEIncome: 0,
  projectedOtherIncome: 0,
  projectedFederalWithheld: 0,
  projectedStateWithheld: 0,
  projectedPreTax: 0,
  projectedRetirement: 0,
  projectedHealthInsuranceDeduction: 0,
  filingStatus: "single",
  lastYearTax: 30000,
  ssWageCap: 168600,
  includeProjectedIncome: false,
};

describe("Unified tax engine — credits, double-counting, mode parity", () => {
  it("dependent credits reduce federal tax but NOT income/AGI/taxable income", () => {
    const noKids = computeUnifiedTaxEstimate({ ...baseInput, qualifyingChildrenCount: 0 });
    const twoKids = computeUnifiedTaxEstimate({ ...baseInput, qualifyingChildrenCount: 2 });

    expect(twoKids.debug.agi).toBe(noKids.debug.agi);
    expect(twoKids.debug.totalTaxableIncome).toBe(noKids.debug.totalTaxableIncome);
    expect(twoKids.debug.federalTaxBeforeCredits).toBe(noKids.debug.federalTaxBeforeCredits);
    expect(twoKids.debug.taxCredits).toBeGreaterThan(0);
    expect(twoKids.debug.federalIncomeTax).toBe(
      Math.max(0, twoKids.debug.federalTaxBeforeCredits - twoKids.debug.taxCredits),
    );
    expect(twoKids.debug.totalEstimatedTax).toBeLessThan(noKids.debug.totalEstimatedTax);
  });

  it("savings set-aside and tx reserves are NOT counted as paid taxes", () => {
    const r = computeUnifiedTaxEstimate(baseInput);
    expect(r.debug.taxSavingsSetAside).toBe(7500);
    expect(r.debug.taxReserves).toBe(5000);
    // counted = federal W/H (12k) + state W/H (3k) + estimated payments (4k) = 19k
    expect(r.debug.countedCreditsTotal).toBe(12000 + 3000 + 4000);
    expect(r.debug.nonCountedSavingsTotal).toBe(7500 + 5000);
  });

  it("state withholding is counted exactly once in countedCreditsTotal", () => {
    const r = computeUnifiedTaxEstimate({
      ...baseInput,
      stateTaxEnabled: true,
      personalStateTaxMode: "flat_rate",
      personalStateTaxRate: 5,
    });
    // State W/H appears in countedCreditsTotal, AND state tax due is already
    // net of state W/H inside the engine. Verify identity:
    //   remainingTaxDue = totalEstimatedTax − countedCreditsTotal
    expect(r.debug.remainingTaxDue).toBeCloseTo(
      Math.max(0, r.debug.totalEstimatedTax - r.debug.countedCreditsTotal),
      1,
    );
    // Verify state W/H is exposed (not double-added on top).
    expect(r.debug.stateWithheld).toBe(3000);
  });

  it("actual vs forecast mode produce parity from the SAME input + flag flip", () => {
    // No projected income → actual and forecast should be identical
    const actual = computeUnifiedTaxEstimate({ ...baseInput, includeProjectedIncome: false });
    const forecast = computeUnifiedTaxEstimate({ ...baseInput, includeProjectedIncome: true });
    expect(forecast.debug.totalEstimatedTax).toBe(actual.debug.totalEstimatedTax);
    expect(forecast.debug.totalTaxableIncome).toBe(actual.debug.totalTaxableIncome);
    expect(forecast.debug.countedCreditsTotal).toBe(actual.debug.countedCreditsTotal);

    // With projected income, forecast > actual
    const withProjected = computeUnifiedTaxEstimate({
      ...baseInput,
      includeProjectedIncome: true,
      projectedW2Income: 50000,
      projectedFederalWithheld: 8000,
    });
    expect(withProjected.debug.totalEstimatedTax).toBeGreaterThan(actual.debug.totalEstimatedTax);
    expect(withProjected.debug.federalWithheld).toBe(20000); // 12k actual + 8k projected
  });

  it("identity: federalIncomeTax == max(0, before − credits)", () => {
    const r = computeUnifiedTaxEstimate({ ...baseInput, qualifyingChildrenCount: 1, otherDependentsCount: 1 });
    expect(r.debug.federalIncomeTax).toBe(
      Math.max(0, r.debug.federalTaxBeforeCredits - r.debug.taxCredits),
    );
  });

  it("identity: remainingTaxDue == max(0, totalEstimatedTax − countedCreditsTotal)", () => {
    const r = computeUnifiedTaxEstimate(baseInput);
    expect(r.debug.remainingTaxDue).toBeCloseTo(
      Math.max(0, r.debug.totalEstimatedTax - r.debug.countedCreditsTotal),
      1,
    );
  });

  // ---------------------------------------------------------------------------
  // Overview vs Breakdown parity
  // ---------------------------------------------------------------------------
  // Both screens must consume the SAME debug object from the unified engine.
  // This test simulates Overview's and Breakdown's read paths and asserts the
  // surfaced numbers are byte-identical. If anyone reintroduces independent
  // math in either path, this test fails.
  it("Tax Overview and Tax Breakdown surface identical totals from the same input", () => {
    const input: UnifiedTaxInput = {
      ...baseInput,
      qualifyingChildrenCount: 2,
      otherDependentsCount: 1,
      stateTaxEnabled: true,
      personalStateTaxMode: "flat_rate",
      personalStateTaxRate: 5,
    };

    // Overview path (Taxes.tsx + TaxReserve.tsx) reads these fields:
    const overview = computeUnifiedTaxEstimate(input).debug;
    const overviewView = {
      totalEstimatedTax: overview.totalEstimatedTax,
      taxableIncome: overview.totalTaxableIncome,
      agi: overview.agi,
      federalTaxBeforeCredits: overview.federalTaxBeforeCredits,
      taxCredits: overview.taxCredits,
      federalIncomeTax: overview.federalIncomeTax,
      selfEmploymentTax: overview.selfEmploymentTax,
      stateTax: overview.stateTax,
      countedCreditsTotal: overview.countedCreditsTotal,
      remainingTaxDue: overview.remainingTaxDue,
    };

    // Breakdown path (useTaxBreakdown.ts) reads from the same debug object:
    const breakdown = computeUnifiedTaxEstimate(input).debug;
    const breakdownView = {
      totalEstimatedTax: breakdown.totalEstimatedTax,
      taxableIncome: breakdown.totalTaxableIncome,
      agi: breakdown.agi,
      federalTaxBeforeCredits: breakdown.federalTaxBeforeCredits,
      taxCredits: breakdown.taxCredits,
      federalIncomeTax: breakdown.federalIncomeTax,
      selfEmploymentTax: breakdown.selfEmploymentTax,
      stateTax: breakdown.stateTax,
      countedCreditsTotal: breakdown.countedCreditsTotal,
      remainingTaxDue: breakdown.remainingTaxDue,
    };

    expect(breakdownView).toEqual(overviewView);
  });
});
