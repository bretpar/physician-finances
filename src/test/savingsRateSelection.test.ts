import { describe, expect, it } from "vitest";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";

const actualEstimate = {
  federalEffectiveRate: 11.1,
  effectiveRate: 14.2,
  federalTax: 11100,
  personalStateTax: 0,
  totalTaxLiability: 14200,
  taxableIncome: 80000,
  totalIncome: 100000,
  totalReturnIncomeBeforeAdjustments: 100000,
  seTax: { total: 1500 },
} as any;

const forecastEstimate = {
  federalEffectiveRate: 12.4,
  effectiveRate: 17,
  federalTax: 17300,
  personalStateTax: 700,
  totalTaxLiability: 23800,
  taxableIncome: 100000,
  totalIncome: 140000,
  totalReturnIncomeBeforeAdjustments: 140000,
  seTax: { total: 1500 },
} as any;

const dynamicSettings = {
  withholdingMethod: "dynamic_actual",
  businessStateTaxEnabled: true,
  businessStateTaxRate: 1.5,
  businessStateTaxApplicationMode: "all_business",
};

describe("getSelectedWithholdingProfileRate", () => {
  it("uses the flat estimate as the shared manual profile rate", () => {
    const result = getSelectedWithholdingProfileRate({
      taxSettings: { withholdingMethod: "flat_estimate", manualEffectiveTaxRate: 20 },
      actualEstimate,
      forecastEstimate,
    });

    expect(result.source).toBe("flat_estimate");
    expect(result.estimateSource).toBe("manual");
    expect(result.label).toBe("Using manual tax rate");
    expect(result.federalProfileRate).toBe(20);
    expect(result.canonicalEffectiveTaxRate).toBe(20);
  });

  it("uses actual-only federalEffectiveRate and effectiveRate for dynamic_actual", () => {
    const result = getSelectedWithholdingProfileRate({
      taxSettings: { withholdingMethod: "dynamic_actual" },
      actualEstimate,
      forecastEstimate,
    });

    expect(result.source).toBe("dynamic_actual");
    expect(result.estimateSource).toBe("actual-only");
    expect(result.label).toBe("Based on actual income only");
    expect(result.federalProfileRate).toBe(11.1);
    expect(result.canonicalEffectiveTaxRate).toBe(14.2);
  });

  it("uses forecast federalEffectiveRate and effectiveRate for dynamic_planner", () => {
    const result = getSelectedWithholdingProfileRate({
      taxSettings: { withholdingMethod: "dynamic_planner" },
      actualEstimate,
      forecastEstimate,
    });

    expect(result.source).toBe("dynamic_planner");
    expect(result.estimateSource).toBe("forecast");
    expect(result.label).toBe("Includes planned/future income");
    expect(result.federalProfileRate).toBe(12.4);
    expect(result.canonicalEffectiveTaxRate).toBe(17);
  });
});

describe("getSavingsRateForIncomeBucket", () => {
  it("1099 uses federalEffectiveRate + SE tax + business state tax", () => {
    const result = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "1099_schedule_c",
      taxSettings: dynamicSettings,
      actualEstimate,
      forecastEstimate,
      companyId: "company-a",
      applyBusinessStateTax: true,
    });

    expect(result.components.federal).toBe(11.1);
    expect(result.components.selfEmployment).toBeCloseTo(14.13, 2);
    expect(result.components.businessState).toBe(1.5);
    expect(result.rate).toBeCloseTo(26.73, 2);
  });

  it("W-2 uses effectiveRate only and never adds SE or business state", () => {
    const result = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "w2",
      taxSettings: dynamicSettings,
      actualEstimate,
      forecastEstimate,
    });

    expect(result.components.federal).toBe(14.2);
    expect(result.components.selfEmployment).toBe(0);
    expect(result.components.businessState).toBe(0);
    expect(result.rate).toBe(14.2);
  });

  it("other personal income uses effectiveRate only", () => {
    const result = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "other_income",
      taxSettings: dynamicSettings,
      actualEstimate,
      forecastEstimate,
    });

    expect(result.components.federal).toBe(14.2);
    expect(result.components.selfEmployment).toBe(0);
    expect(result.components.businessState).toBe(0);
    expect(result.rate).toBe(14.2);
  });

  it("K-1 defaults to SE tax unless the company toggle is off", () => {
    const defaultK1 = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "k1_partnership",
      taxSettings: dynamicSettings,
      actualEstimate,
      forecastEstimate,
      applyBusinessStateTax: true,
    });
    const toggleOffK1 = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "k1_partnership",
      taxSettings: dynamicSettings,
      actualEstimate,
      forecastEstimate,
      applyBusinessStateTax: true,
      includeSETaxInRecommendation: false,
    });

    expect(defaultK1.components.federal).toBe(12.4);
    expect(defaultK1.components.selfEmployment).toBeCloseTo(14.13, 2);
    expect(defaultK1.components.businessState).toBe(1.5);
    expect(defaultK1.rate).toBeCloseTo(28.03, 2);
    expect(toggleOffK1.components.selfEmployment).toBe(0);
    expect(toggleOffK1.rate).toBe(13.9);
  });

  it("S-corp distribution never adds SE tax", () => {
    const result = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "scorp_distribution",
      taxSettings: dynamicSettings,
      actualEstimate,
      forecastEstimate,
      applyBusinessStateTax: true,
    });

    expect(result.components.federal).toBe(12.4);
    expect(result.components.selfEmployment).toBe(0);
    expect(result.components.businessState).toBe(1.5);
    expect(result.rate).toBe(13.9);
  });

  it("flat mode uses the manual user input as the base rate", () => {
    const settings = {
      withholdingMethod: "flat_estimate",
      manualEffectiveTaxRate: 20,
      businessStateTaxEnabled: true,
      businessStateTaxRate: 1.5,
      businessStateTaxApplicationMode: "all_business",
    };
    const personal = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "w2",
      taxSettings: settings,
      actualEstimate,
      forecastEstimate,
    });
    const business = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "1099_schedule_c",
      taxSettings: settings,
      actualEstimate,
      forecastEstimate,
      applyBusinessStateTax: true,
    });

    expect(personal.components.federal).toBe(20);
    expect(personal.rate).toBe(20);
    expect(business.components.federal).toBe(20);
    expect(business.components.selfEmployment).toBeCloseTo(14.13, 2);
    expect(business.components.businessState).toBe(1.5);
    expect(business.rate).toBeCloseTo(35.63, 2);
  });

  it("excludes business state/B&O when selected-company rules do not include the company", () => {
    const result = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "1099_schedule_c",
      taxSettings: {
        withholdingMethod: "dynamic_actual",
        businessStateTaxEnabled: true,
        businessStateTaxRate: 1.5,
        businessStateTaxApplicationMode: "selected",
        businessStateTaxCompanyIds: ["company-a"],
      },
      actualEstimate,
      forecastEstimate,
      companyId: "company-b",
      applyBusinessStateTax: true,
    });

    expect(result.components.businessState).toBe(0);
    expect(result.components.federal).toBe(12.4);
    expect(result.rate).toBeCloseTo(26.53, 2);
  });
});
