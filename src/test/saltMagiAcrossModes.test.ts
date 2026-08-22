/**
 * SALT phase-down MAGI source — regression across the three calculation modes
 * the Tax Overview exposes:
 *
 *   1. Actual (YTD only)
 *   2. Include Planned (actual + projected future income)
 *   3. Annualized / current pace (YTD scaled to a full year)
 *
 * The phase-down must always key off the canonical AGI/MAGI the engine
 * computes for that mode — never off a gross-income bucket. These scenarios
 * deliberately give each mode a different mix of gross buckets (personal W-2,
 * business/SE, projected) so a bucket-based MAGI would produce a different
 * (wrong) cap than the canonical AGI does.
 */
import { describe, it, expect } from "vitest";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";
import {
  SALT_CAP_2026,
  resolveCanonicalDeduction,
  type EngineItemizedInputs,
} from "@/lib/saltDeduction";

const PHASEDOWN_THRESHOLD = 505_000;

const itemized = (over: Partial<EngineItemizedInputs> = {}): EngineItemizedInputs => ({
  propertyTax: 30_000,
  stateIncomeTaxMode: "manual",
  stateIncomeTaxEstimate: 0,
  stateIncomeTaxManual: 25_000,
  salesTaxBase: 0,
  salesTaxLargePurchases: 0,
  personalPropertyTax: 0,
  forceSalesTaxElection: false,
  otherItemizedDeductions: 0,
  mortgageInterest: 0,
  mortgageBalance: null,
  ...over,
});

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
    filingStatus: "married_filing_jointly",
    lastYearTax: 0,
    ssWageCap: 184_500,
    includeProjectedIncome: false,
    businessNonW2HsaAboveLine: 0,
    personalNonW2HsaAboveLine: 0,
    itemizedInputs: itemized(),
    ...overrides,
  } as UnifiedTaxInput;
}

/** Expected SALT-limited itemized deduction for a given canonical MAGI. */
const expectedFor = (magi: number) =>
  resolveCanonicalDeduction({
    filingStatus: "married_filing_jointly",
    magi,
    itemizedInputs: itemized(),
  }).itemizedDeduction;

/** Annualize the YTD actual inputs exactly the way useTaxEstimate's current-pace mode does. */
function annualize(actual: UnifiedTaxInput, factor: number): UnifiedTaxInput {
  return {
    ...actual,
    businessIncome: actual.businessIncome * factor,
    seEligibleBusinessIncome: actual.seEligibleBusinessIncome * factor,
    businessExpenses: actual.businessExpenses * factor,
    businessRetirement: actual.businessRetirement * factor,
    personalIncome: actual.personalIncome * factor,
    personalW2: actual.personalW2 * factor,
    personalNonW2Income: actual.personalNonW2Income * factor,
    personalPreTax: actual.personalPreTax * factor,
    personalRetirement: actual.personalRetirement * factor,
    includeProjectedIncome: false,
  };
}

describe("SALT phase-down MAGI source across calculation modes", () => {
  // YTD actual: $560k gross buckets, but $70k of 401(k)/pre-tax puts canonical
  // AGI below the $505k phase-down threshold.
  const actual = baseInput({
    personalIncome: 360_000,
    personalW2: 360_000,
    personalRetirement: 40_000,
    businessIncome: 200_000,
    seEligibleBusinessIncome: 200_000,
    businessRetirement: 30_000,
  });

  it("Actual mode: uses canonical AGI (below threshold) even though gross buckets exceed it", () => {
    const r = computeUnifiedTaxEstimate(actual);
    const grossBuckets = 560_000;
    expect(grossBuckets).toBeGreaterThan(PHASEDOWN_THRESHOLD);
    expect(r.estimate.agi).toBeLessThan(PHASEDOWN_THRESHOLD);
    expect(r.estimate.deductionType).toBe("itemized");
    // No phase-down: full statutory MFJ cap drives the itemized total.
    expect(r.estimate.deductionApplied).toBeCloseTo(SALT_CAP_2026, 2);
    expect(r.estimate.deductionApplied).toBeCloseTo(expectedFor(r.estimate.agi), 2);
  });

  it("Include-Planned mode: phases down against the planned-inclusive canonical AGI", () => {
    const planned = {
      ...actual,
      includeProjectedIncome: true,
      projectedW2Income: 150_000,
      projectedSEIncome: 60_000,
      projectedOtherIncome: 0,
    };
    const actualR = computeUnifiedTaxEstimate(actual);
    const plannedR = computeUnifiedTaxEstimate(planned as UnifiedTaxInput);

    expect(plannedR.estimate.agi).toBeGreaterThan(actualR.estimate.agi);
    expect(plannedR.estimate.agi).toBeGreaterThan(PHASEDOWN_THRESHOLD);
    // Phase-down engaged only in the planned mode, and matches the canonical
    // resolver evaluated at THIS mode's AGI.
    expect(plannedR.estimate.deductionApplied).toBeLessThan(actualR.estimate.deductionApplied);
    expect(plannedR.estimate.deductionApplied).toBeCloseTo(expectedFor(plannedR.estimate.agi), 2);
  });

  it("Annualized mode: phases down against its own annualized canonical AGI", () => {
    // Four months elapsed → factor 3. Same YTD buckets, different MAGI.
    const annualizedR = computeUnifiedTaxEstimate(annualize(actual, 3));
    const actualR = computeUnifiedTaxEstimate(actual);

    expect(annualizedR.estimate.agi).toBeCloseTo(actualR.estimate.agi * 3, 0);
    expect(annualizedR.estimate.agi).toBeGreaterThan(PHASEDOWN_THRESHOLD);
    expect(annualizedR.estimate.deductionApplied).toBeCloseTo(
      expectedFor(annualizedR.estimate.agi),
      2,
    );
    expect(annualizedR.estimate.deductionApplied).toBeLessThan(actualR.estimate.deductionApplied);
  });

  it("all three modes agree whenever their canonical AGI agrees, regardless of bucket mix", () => {
    // Same canonical AGI reached three different ways:
    //   personal-only actual, business-heavy actual, planned-driven.
    const personalHeavy = computeUnifiedTaxEstimate(
      baseInput({ personalIncome: 600_000, personalW2: 600_000 }),
    );
    const businessHeavy = computeUnifiedTaxEstimate(
      baseInput({
        businessIncome: 600_000,
        seEligibleBusinessIncome: 0, // no SE-tax adjustment → same AGI path
        personalIncome: 0,
      }),
    );
    const plannedDriven = computeUnifiedTaxEstimate(
      baseInput({
        personalIncome: 200_000,
        personalW2: 200_000,
        includeProjectedIncome: true,
        projectedW2Income: 400_000,
      }) as UnifiedTaxInput,
    );

    for (const r of [personalHeavy, businessHeavy, plannedDriven]) {
      expect(r.estimate.agi).toBeCloseTo(600_000, 0);
      expect(r.estimate.deductionApplied).toBeCloseTo(expectedFor(600_000), 2);
    }
  });

  it("SALT is never phased below the statutory floor no matter how high a mode's MAGI is", () => {
    const extreme = computeUnifiedTaxEstimate(
      baseInput({ personalIncome: 3_000_000, personalW2: 3_000_000 }),
    );
    expect(extreme.estimate.deductionApplied).toBeCloseTo(expectedFor(extreme.estimate.agi), 2);
    // Floor keeps at least $10k of SALT in the itemized total for MFJ.
    expect(expectedFor(extreme.estimate.agi)).toBeGreaterThanOrEqual(10_000);
  });
});
