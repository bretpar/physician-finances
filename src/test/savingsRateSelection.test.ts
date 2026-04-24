import { describe, expect, it } from "vitest";
import { getSavingsRateForIncomeBucket } from "@/lib/savingsRateSelection";

const estimate = {
  federalEffectiveRate: 17,
  totalIncome: 100000,
  seTax: { total: 1500 },
} as any;

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
      forecastEstimate: estimate,
      companyId: "company-a",
      applyBusinessStateTax: true,
    });

    expect(result.components.personalState).toBe(0);
    expect(result.components.businessState).toBe(1.5);
    expect(result.rate).toBeCloseTo(20, 2);
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
      forecastEstimate: estimate,
      companyId: "company-b",
      applyBusinessStateTax: true,
    });

    expect(result.components.businessState).toBe(0);
    expect(result.rate).toBeCloseTo(18.5, 2);
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
      forecastEstimate: estimate,
    });

    expect(result.components.businessState).toBe(0);
    expect(result.components.selfEmployment).toBe(0);
    expect(result.rate).toBe(17);
  });
});