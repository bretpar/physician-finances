import { describe, it, expect } from "vitest";
import {
  selectFinancialAssistantRecommendation,
  type FinancialAssistantRecommendationInput,
} from "@/lib/financialAssistantRecommendation";

const base: FinancialAssistantRecommendationInput = {
  isReady: true,
  projectedAnnualIncome: 300_000,
  annualTaxLiability: 90_000,
  savingsCoverageRatio: 1,
  quarterLabel: "Q3",
  deadlineLabel: "Sep 15",
  daysUntilDue: 40,
  showQuarterly: true,
  hasRetirement: true,
  hasHsa: true,
  hasHomeOffice: true,
  hasMileage: true,
};

const pick = (o: Partial<FinancialAssistantRecommendationInput> = {}) =>
  selectFinancialAssistantRecommendation({ ...base, ...o });

describe("selectFinancialAssistantRecommendation", () => {
  it("returns a neutral placeholder while data loads", () => {
    expect(pick({ isReady: false, hasRetirement: false }).id).toBe("loading");
  });

  it("prioritizes adding income above everything else", () => {
    expect(pick({ projectedAnnualIncome: 0, hasRetirement: false, savingsCoverageRatio: 0 }).id).toBe("add-income");
  });

  it("flags an overdue quarterly shortfall first", () => {
    expect(pick({ savingsCoverageRatio: 0.2, daysUntilDue: -3, hasRetirement: false }).id).toBe("quarterly-overdue");
  });

  it("flags an urgent quarterly shortfall", () => {
    expect(pick({ savingsCoverageRatio: 0.3, daysUntilDue: 10 }).id).toBe("quarterly-due-soon");
  });

  it("flags a non-urgent quarterly shortfall", () => {
    expect(pick({ savingsCoverageRatio: 0.3, daysUntilDue: 45 }).id).toBe("quarterly-shortfall");
  });

  it("ignores quarterly when it does not apply", () => {
    expect(pick({ showQuarterly: false, savingsCoverageRatio: 0, hasRetirement: false }).id).toBe("retirement");
  });

  it("ignores quarterly when there is no tax liability", () => {
    expect(pick({ annualTaxLiability: 0, savingsCoverageRatio: 0, hasHsa: false }).id).toBe("hsa");
  });

  it("treats 95%+ of today's pace as on track and 80-95% as slightly behind", () => {
    expect(pick({ savingsCoverageRatio: 0.95 }).id).toBe("all-set");
    expect(pick({ savingsCoverageRatio: 0.9 }).id).toBe("quarterly-slightly-behind");
    expect(pick({ savingsCoverageRatio: 0.8 }).id).toBe("quarterly-slightly-behind");
    expect(pick({ savingsCoverageRatio: 0.799 }).id).toBe("quarterly-shortfall");
  });

  it("does not escalate a slight lag to overdue-red wording", () => {
    expect(pick({ savingsCoverageRatio: 0.9, daysUntilDue: 5 }).id).toBe("quarterly-slightly-behind");
  });

  it("orders savings gaps retirement > hsa > home office > mileage", () => {
    expect(pick({ hasRetirement: false, hasHsa: false, hasHomeOffice: false, hasMileage: false }).id).toBe("retirement");
    expect(pick({ hasHsa: false, hasHomeOffice: false, hasMileage: false }).id).toBe("hsa");
    expect(pick({ hasHomeOffice: false, hasMileage: false }).id).toBe("home-office");
    expect(pick({ hasMileage: false }).id).toBe("mileage");
  });

  it("returns all-set when nothing needs attention", () => {
    expect(pick().id).toBe("all-set");
  });

  it("never returns conflicting priorities and always yields one item", () => {
    const rec = pick({ savingsCoverageRatio: 0.1, hasRetirement: false, hasHsa: false });
    expect(rec.id).toBe("quarterly-shortfall");
    expect(rec.to).toBe("/taxes");
  });

  it("tolerates NaN/invalid numbers", () => {
    const rec = pick({
      projectedAnnualIncome: Number.NaN,
      annualTaxLiability: Number.NaN,
      savingsCoverageRatio: Number.NaN,
      daysUntilDue: Number.NaN,
    });
    expect(rec.id).toBe("add-income");
  });

  it("falls back to a generic quarter label", () => {
    expect(pick({ quarterLabel: "", savingsCoverageRatio: 0 }).text).toContain("this quarter");
  });
});
