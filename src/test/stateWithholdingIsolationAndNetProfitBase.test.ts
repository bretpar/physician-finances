/**
 * State withholding credited once per liability; generic net_profit business
 * tax base = gross − operating expenses − mileage (before owner deductions).
 */
import { describe, it, expect } from "vitest";
import { computeUnifiedTaxEstimate } from "@/lib/taxCalculationService";
import { calculateBusinessStateTax } from "@/lib/taxEngine";
import { computeCanonicalEventRecommendation } from "@/lib/canonicalEventRecommendation";

function run(o: Record<string, unknown> = {}): any {
  return computeUnifiedTaxEstimate({
    businessIncome: 0, seEligibleBusinessIncome: 0, businessW2: 0, businessFederalWithheld: 0,
    businessStateWithheld: 0, businessPreTax: 0, businessRetirement: 0, ownerHealthcare: 0,
    businessStateEligibleGross: 0, businessStateEligibleExpenses: 0, businessStateEligibleMileage: 0,
    businessStateEligibleOwnerAdjustments: 0, personalIncome: 100_000, personalW2: 100_000,
    personalNonW2Income: 0, personalFederalWithheld: 5_000, personalStateWithheld: 0,
    personalPreTax: 0, personalRetirement: 0, netStockGain: 0, businessExpenses: 0, mileageDeduction: 0,
    annualizedRetirement: 0, txActualWithholding: 0, actualEstimatedPaymentsMade: 0, taxSavingsSetAside: 0,
    remainingPayPeriods: 10, projectedW2Income: 0, projectedSEIncome: 0, projectedOtherIncome: 0,
    projectedFederalWithheld: 0, projectedStateWithheld: 0, projectedPreTax: 0, projectedRetirement: 0,
    projectedHealthInsuranceDeduction: 0, filingStatus: "single", lastYearTax: 0,
    standardDeductionOverride: null, ssWageCap: 184_500, stateIncomeTaxEnabled: true,
    personalStateTaxMode: "annual_estimate", personalStateTaxAnnualEstimate: 1_000,
    businessStateTaxEnabled: false, businessStateTaxRate: 1.5, businessStateTaxBase: "gross",
    businessStateEligibleGrossOverride: undefined, includeProjectedIncome: false, ...o,
  } as any);
}
const withBiz = {
  businessIncome: 10_000, seEligibleBusinessIncome: 10_000,
  businessStateTaxEnabled: true, businessStateEligibleGross: 10_000,
};

describe("state withholding offsets each state liability once", () => {
  it("personal only: $400 personal withholding → $600 personal state due", () => {
    expect(run({ personalStateWithheld: 400 }).estimate.personalStateTax).toBe(600);
  });
  it("business only: $50 business withholding → $100 business state due", () => {
    const r = run({ ...withBiz, personalStateTaxAnnualEstimate: 0, businessStateWithheld: 50 });
    expect(r.estimate.businessStateTax).toBeCloseTo(100, 2);
  });
  it("both: business withholding never also reduces personal state tax", () => {
    const r = run({ ...withBiz, personalStateWithheld: 400, businessStateWithheld: 50 });
    expect(r.estimate.personalStateTax).toBe(600); // was $550 (double-credited)
    expect(r.estimate.businessStateTax).toBeCloseTo(100, 2);
  });
  it("excess state withholding floors state at $0 and never reduces federal", () => {
    const base = run({ ...withBiz });
    const r = run({ ...withBiz, personalStateWithheld: 9_000, businessStateWithheld: 9_000 });
    expect(r.estimate.personalStateTax).toBe(0);
    expect(r.estimate.businessStateTax).toBe(0);
    expect(r.estimate.federalTax).toBe(base.estimate.federalTax);
    expect(r.debug.remainingTaxDue).toBeCloseTo(r.estimate.federalTax + r.estimate.seTax.total - 5_000, 2);
  });
});

describe("generic net_profit business tax base", () => {
  const annual = (owner: number, base: "gross" | "net_profit") => calculateBusinessStateTax({ inputs: {
    businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: base,
    eligibleBusinessGross: 10_000, eligibleBusinessExpenses: 1_000, eligibleBusinessOwnerAdjustments: owner,
  } as any }).tax;
  const perEntry = (owner: number, base: "gross" | "net_profit") => computeCanonicalEventRecommendation({
    estimate: { businessStateEligibleGross: 0, businessStateEligibleExpenses: 1_000,
      seTax: { netSEIncome: 0, w2SsWagesUsed: 0, plannedW2SsWagesUsed: 0 } } as any,
    taxSettings: { withholdingMethod: "dynamic_actual", filingStatus: "single",
      businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: base } as any,
    incomeType: "1099_schedule_c", incomeBucket: "business", grossIncome: 10_000,
    retirement401k: owner / 2, federalOnlyDeductions: owner / 2, creditedWithholding: 0, catchUpAmount: 0,
  })!.target.businessStateTax;

  it("$10,000 − $1,000 expenses × 1.5% = $135, with or without a $600 owner deduction", () => {
    expect(annual(0, "net_profit")).toBe(135);
    expect(annual(600, "net_profit")).toBe(135); // was $126
    expect(perEntry(0, "net_profit")).toBe(135);
    expect(perEntry(600, "net_profit")).toBe(135);
  });
  it("gross base unchanged at $150", () => {
    expect(annual(600, "gross")).toBe(150);
    expect(perEntry(600, "gross")).toBe(150);
  });
});
