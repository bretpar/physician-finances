import { describe, expect, it } from "vitest";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";

const estimate = {
  federalEffectiveRate: 17,
  federalTax: 11100,
  taxableIncome: 100000,
  totalIncome: 100000,
  seTax: { total: 1500 },
} as any;

const forecastEstimate = {
  federalEffectiveRate: 19,
  federalTax: 17300,
  taxableIncome: 100000,
  totalIncome: 140000,
  seTax: { total: 1500 },
} as any;

describe("getSelectedWithholdingProfileRate", () => {
  it("uses the flat estimate as the shared federal profile rate", () => {
    const result = getSelectedWithholdingProfileRate({
      taxSettings: { withholdingMethod: "flat_estimate", manualEffectiveTaxRate: 20 },
      actualEstimate: estimate,
      forecastEstimate,
    });

    expect(result.source).toBe("flat_estimate");
    expect(result.federalProfileRate).toBe(20);
  });

  it("uses forecast federal tax after credits divided by forecast taxable income for dynamic_actual", () => {
    const result = getSelectedWithholdingProfileRate({
      taxSettings: { withholdingMethod: "dynamic_actual" },
      actualEstimate: estimate,
      forecastEstimate,
    });

    expect(result.source).toBe("dynamic_actual");
    expect(result.federalProfileRate).toBe(17.3);
  });

  it("uses forecast federal tax after credits divided by forecast taxable income", () => {
    const result = getSelectedWithholdingProfileRate({
      taxSettings: { withholdingMethod: "dynamic_planner" },
      actualEstimate: estimate,
      forecastEstimate,
    });

    expect(result.source).toBe("dynamic_planner");
    expect(result.federalProfileRate).toBe(17.3);
  });
});

describe("getSavingsRateForIncomeBucket state tax selection", () => {
  it("includes business state/B&O without requiring personal state income tax", () => {
    const result = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "1099_schedule_c",
      taxSettings: {
        withholdingMethod: "dynamic_actual",
        stateIncomeTaxEnabled: false,
        businessStateTaxEnabled: true,
        businessStateTaxRate: 1.5,
        businessStateTaxApplicationMode: "all_business",
      },
      actualEstimate: estimate,
      forecastEstimate,
      companyId: "company-a",
      applyBusinessStateTax: true,
    });

    expect(result.components.personalState).toBe(0);
    expect(result.components.businessState).toBe(1.5);
    expect(result.components.federal).toBe(17.3);
    expect(result.rate).toBeCloseTo(20.3, 2);
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
      actualEstimate: estimate,
      forecastEstimate,
      companyId: "company-b",
      applyBusinessStateTax: true,
    });

    expect(result.components.businessState).toBe(0);
    expect(result.components.federal).toBe(17.3);
    expect(result.rate).toBeCloseTo(18.8, 2);
  });

  it("keeps personal income free of business state/B&O", () => {
    const result = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "w2",
      taxSettings: {
        withholdingMethod: "dynamic_actual",
        stateIncomeTaxEnabled: false,
        businessStateTaxEnabled: true,
        businessStateTaxRate: 1.5,
      },
      actualEstimate: estimate,
      forecastEstimate,
    });

    expect(result.components.businessState).toBe(0);
    expect(result.components.selfEmployment).toBe(0);
    expect(result.components.federal).toBe(17.3);
    expect(result.rate).toBe(17.3);
  });

  it("uses the same selected federal profile rate for personal and business before add-ons", () => {
    const settings = {
      withholdingMethod: "flat_estimate",
      manualEffectiveTaxRate: 20,
      businessStateTaxEnabled: true,
      businessStateTaxRate: 1.5,
    };
    const personal = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "w2",
      taxSettings: settings,
      actualEstimate: estimate,
      forecastEstimate,
    });
    const business = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "1099_schedule_c",
      taxSettings: settings,
      actualEstimate: estimate,
      forecastEstimate,
    });

    expect(personal.components.federal).toBe(20);
    expect(business.components.federal).toBe(20);
    expect(personal.components.businessState).toBe(0);
    expect(business.components.businessState).toBe(1.5);
  });

  it("uses the same forecast federal profile rate in both dynamic modes before business add-ons", () => {
    const dynamicActualPersonal = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "w2",
      taxSettings: { withholdingMethod: "dynamic_actual", businessStateTaxEnabled: true, businessStateTaxRate: 1.5 },
      actualEstimate: estimate,
      forecastEstimate,
    });
    const dynamicActualBusiness = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "1099_schedule_c",
      taxSettings: { withholdingMethod: "dynamic_actual", businessStateTaxEnabled: true, businessStateTaxRate: 1.5 },
      actualEstimate: estimate,
      forecastEstimate,
      applyBusinessStateTax: true,
    });
    const dynamicPlannerPersonal = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "w2",
      taxSettings: { withholdingMethod: "dynamic_planner", businessStateTaxEnabled: true, businessStateTaxRate: 1.5 },
      actualEstimate: estimate,
      forecastEstimate,
    });

    expect(dynamicActualPersonal.components.federal).toBe(17.3);
    expect(dynamicActualBusiness.components.federal).toBe(17.3);
    expect(dynamicPlannerPersonal.components.federal).toBe(17.3);
    expect(dynamicActualBusiness.components.selfEmployment).toBe(1.5);
    expect(dynamicActualBusiness.components.businessState).toBe(1.5);
  });

  it("acceptance: personal paycheck target uses the shared federal profile rate while business adds only SE and B&O", () => {
    const taxSettings = {
      withholdingMethod: "flat_estimate",
      manualEffectiveTaxRate: 20,
      stateTaxEnabled: false,
      stateIncomeTaxEnabled: false,
      businessStateTaxEnabled: true,
      businessStateTaxRate: 1.5,
      businessStateTaxApplicationMode: "all_business",
    };
    const taxablePaycheckAmount = 1_000;
    const totalFederalPayrollTaxesAlreadyWithheld = 150;
    const taxableBusinessIncome = 1_000;

    const profile = getSelectedWithholdingProfileRate({
      taxSettings,
      actualEstimate: estimate,
      forecastEstimate,
    });
    const personal = getSavingsRateForIncomeBucket({
      incomeBucket: "personal",
      incomeType: "w2",
      taxSettings,
      actualEstimate: estimate,
      forecastEstimate,
    });
    const business = getSavingsRateForIncomeBucket({
      incomeBucket: "business",
      incomeType: "1099_schedule_c",
      taxSettings,
      actualEstimate: estimate,
      forecastEstimate,
      applyBusinessStateTax: true,
    });

    const paycheckTarget = taxablePaycheckAmount * (personal.components.federal / 100);
    const recommendedExtraSavings = paycheckTarget - totalFederalPayrollTaxesAlreadyWithheld;
    const businessTarget = taxableBusinessIncome * (business.rate / 100);

    expect(profile.federalProfileRate).toBe(20);
    expect(personal.components.federal).toBe(profile.federalProfileRate);
    expect(personal.components.employeeSocialSecurity).toBe(0);
    expect(personal.components.employeeMedicare).toBe(0);
    expect(personal.components.selfEmployment).toBe(0);
    expect(personal.components.businessState).toBe(0);
    expect(paycheckTarget).toBe(200);
    expect(recommendedExtraSavings).toBe(50);

    expect(business.components.federal).toBe(profile.federalProfileRate);
    expect(business.components.employeeSocialSecurity).toBe(0);
    expect(business.components.employeeMedicare).toBe(0);
    expect(business.components.personalState).toBe(0);
    expect(business.components.selfEmployment).toBe(1.5);
    expect(business.components.businessState).toBe(1.5);
    expect(business.rate).toBe(23);
    expect(businessTarget).toBe(230);
  });
});