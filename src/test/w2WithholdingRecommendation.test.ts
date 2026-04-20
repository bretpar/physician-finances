/**
 * Unit tests for the W-2 withholding recommendation fix.
 * Ensures W-2 users are not told to save extra for tax already covered by
 * projected future payroll withholding, and that non-W-2 entries still get
 * a reasonable positive set-aside.
 */
import { describe, it, expect } from "vitest";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";

const baseInput: UnifiedTaxInput = {
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
  remainingPayPeriods: 10,
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
  standardDeductionOverride: null,
  ssWageCap: 168600,
  deductionType: "standard",
  itemizedDeductionAmount: 0,
  qualifyingChildrenCount: 0,
  otherDependentsCount: 0,
  withholdingOverrideType: "none",
  withholdingOverridePercent: null,
  withholdingOverrideAmount: null,
  stateTaxEnabled: false,
  personalStateTaxMode: "flat_rate",
  personalStateTaxRate: 0,
  personalStateTaxAnnualEstimate: 0,
  businessStateTaxEnabled: false,
  businessStateTaxRate: 0,
  businessStateTaxBase: "gross",
  includeProjectedIncome: false,

describe("W-2 withholding recommendation — unified annual remaining tax", () => {
  it("Scenario A: W-2 fully covered by projected withholding → remainingTaxDue is 0", () => {
    // High-income W-2 with payroll expected to fully cover annual tax.
    const { debug, estimate } = computeUnifiedTaxEstimate({
      ...baseInput,
      personalW2: 100000,
      personalIncome: 100000,
      personalFederalWithheld: 8000, // YTD actual
      projectedW2Income: 50000,
      projectedFederalWithheld: 40000, // huge projected to guarantee coverage
      includeProjectedIncome: true,
    });
    expect(debug.countedCreditsTotal).toBeGreaterThan(estimate.totalTaxLiability);
    expect(debug.remainingTaxDue).toBe(0);
  });

  it("Scenario B: W-2 partially covered → remainingTaxDue > 0 but less than total liability", () => {
    const { debug, estimate } = computeUnifiedTaxEstimate({
      ...baseInput,
      personalW2: 100000,
      personalIncome: 100000,
      personalFederalWithheld: 5000,
      projectedW2Income: 50000,
      projectedFederalWithheld: 3000,
      includeProjectedIncome: true,
    });
    expect(debug.remainingTaxDue).toBeGreaterThan(0);
    expect(debug.remainingTaxDue).toBeLessThan(estimate.totalTaxLiability);
    expect(debug.projectedFederalWithheld).toBe(3000);
  });

  it("Scenario C: 1099 income with no withholding → remainingTaxDue ≈ total liability", () => {
    const { debug, estimate } = computeUnifiedTaxEstimate({
      ...baseInput,
      businessIncome: 80000,
      seEligibleBusinessIncome: 80000,
      includeProjectedIncome: false,
    });
    expect(debug.countedCreditsTotal).toBe(0);
    expect(debug.remainingTaxDue).toBeCloseTo(estimate.totalTaxLiability, 2);
  });

  it("Scenario D: Tax savings are surfaced but never reduce remaining tax due", () => {
    const { debug } = computeUnifiedTaxEstimate({
      ...baseInput,
      businessIncome: 80000,
      seEligibleBusinessIncome: 80000,
      taxSavingsSetAside: 25000, // informational only
      includeProjectedIncome: false,
    });
    expect(debug.taxSavingsSetAside).toBe(25000);
    // savings must NOT be in countedCreditsTotal
    expect(debug.countedCreditsTotal).toBe(0);
    // savings must be surfaced as non-counted
    expect(debug.nonCountedSavingsTotal).toBeGreaterThanOrEqual(25000);
  });

  it("Planner mode includes projected withholding; actual mode does not", () => {
    const input = {
      ...baseInput,
      personalW2: 100000,
      personalIncome: 100000,
      projectedW2Income: 50000,
      projectedFederalWithheld: 8000,
    };
    const actual = computeUnifiedTaxEstimate({ ...input, includeProjectedIncome: false });
    const planner = computeUnifiedTaxEstimate({ ...input, includeProjectedIncome: true });

    expect(actual.debug.projectedFederalWithheld).toBe(0);
    expect(planner.debug.projectedFederalWithheld).toBe(8000);
    expect(planner.debug.countedCreditsTotal).toBeGreaterThan(actual.debug.countedCreditsTotal);
  });
});
