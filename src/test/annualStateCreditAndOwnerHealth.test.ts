/**
 * Oct 12 audit gap check: annual state withholding double-count, 1099
 * self-employed health deduction collection, and capped reminder credit.
 */
import { describe, it, expect } from "vitest";
import { computeUnifiedTaxEstimate } from "@/lib/taxCalculationService";
import { sumOwnerHealthcareDeduction } from "@/hooks/useTaxEstimate";
import { computeCanonicalEventRecommendation } from "@/lib/canonicalEventRecommendation";
import { resolveAmountSavedForTransaction } from "@/lib/incomeRecommendationSurface";

function run(o: Record<string, unknown> = {}): any {
  return computeUnifiedTaxEstimate({
    businessIncome: 0, seEligibleBusinessIncome: 0, businessW2: 0, businessFederalWithheld: 0,
    businessStateWithheld: 0, businessPreTax: 0, businessRetirement: 0, ownerHealthcare: 0,
    businessStateEligibleGross: 0, businessStateEligibleExpenses: 0, businessStateEligibleMileage: 0,
    businessStateEligibleOwnerAdjustments: 0, personalIncome: 100_000, personalW2: 100_000,
    personalNonW2Income: 0, personalFederalWithheld: 5_000, personalStateWithheld: 1_000,
    personalPreTax: 0, personalRetirement: 0, netStockGain: 0, businessExpenses: 0, mileageDeduction: 0,
    annualizedRetirement: 0, txActualWithholding: 0, actualEstimatedPaymentsMade: 0, taxSavingsSetAside: 0,
    remainingPayPeriods: 10, projectedW2Income: 0, projectedSEIncome: 0, projectedOtherIncome: 0,
    projectedFederalWithheld: 0, projectedStateWithheld: 0, projectedPreTax: 0, projectedRetirement: 0,
    projectedHealthInsuranceDeduction: 0, filingStatus: "single", lastYearTax: 0,
    standardDeductionOverride: null, ssWageCap: 184_500, stateIncomeTaxEnabled: true,
    personalStateTaxMode: "annual_estimate", personalStateTaxAnnualEstimate: 1_000,
    includeProjectedIncome: false, ...o,
  } as any);
}

describe("annual state withholding is not subtracted twice", () => {
  it("$1,000 → $5,000 state withholding leaves remaining federal tax unchanged", () => {
    const a = run({ personalStateWithheld: 1_000 });
    const b = run({ personalStateWithheld: 5_000 });
    expect(a.estimate.federalTax).toBe(b.estimate.federalTax);
    expect(a.debug.remainingTaxDue).toBeCloseTo(a.estimate.federalTax - 5_000, 2);
    expect(b.debug.remainingTaxDue).toBeCloseTo(a.debug.remainingTaxDue, 2);
  });
});

describe("1099 self-employed health deduction", () => {
  it("collects 1099 and K-1 owner health, not W-2 / S-Corp payroll", () => {
    expect(sumOwnerHealthcareDeduction([
      { income_type: "1099_schedule_c", healthcare_deduction: 600 },
      { income_type: "k1_partnership", healthcare_deduction: 100 },
      { income_type: "w2", healthcare_deduction: 999 },
      { income_type: "scorp_w2", healthcare_deduction: 999 },
    ])).toBe(700);
  });
  it("$600 lowers federal tax once and leaves SE tax unchanged", () => {
    const biz = { businessIncome: 100_000, seEligibleBusinessIncome: 100_000, personalIncome: 0, personalW2: 0, personalFederalWithheld: 0 };
    const without = run(biz);
    const withHealth = run({ ...biz, ownerHealthcare: 600 });
    expect(withHealth.estimate.seTax.total).toBe(without.estimate.seTax.total);
    expect(withHealth.estimate.healthInsuranceDeduction).toBe(600);
    const drop = without.estimate.federalTax - withHealth.estimate.federalTax;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThanOrEqual(600 * 0.24 + 0.01); // one deduction at ≤24% marginal
  });
});

describe("after-save reminder uses the capped state credit", () => {
  it("$5,000 state withholding against $150 state tax counts as $150 saved", () => {
    const rec = computeCanonicalEventRecommendation({
      estimate: { seTax: { netSEIncome: 0, w2SsWagesUsed: 0, plannedW2SsWagesUsed: 0 } } as any,
      taxSettings: { withholdingMethod: "dynamic_actual", filingStatus: "single", businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: "gross" } as any,
      incomeType: "1099_schedule_c", incomeBucket: "business", grossIncome: 10_000,
      stateWithholding: 5_000, creditedWithholding: 0, catchUpAmount: 0,
    })!;
    expect(rec.creditedStateWithholding).toBe(150);
    expect(resolveAmountSavedForTransaction({
      taxesWithheld: 0, stateWithheld: rec.creditedStateWithholding, ssWithheld: 0,
      medicareWithheld: 0, additionalTaxReserve: 0, actualWithholding: 0,
    })).toBe(150);
  });
});
