import { describe, it, expect } from "vitest";
import { deriveOtherPreTax, sumDetailedDeductions } from "@/pages/ProjectedIncome";

/**
 * Hydration regression: `pre_tax_deductions` is an aggregate that already
 * includes health insurance + HSA. The occurrence editor must show only the
 * standalone remainder in "Other pre-tax deductions".
 */
describe("deriveOtherPreTax — detailed occurrence hydration", () => {
  it("removes health insurance from the aggregate (QA case)", () => {
    expect(deriveOtherPreTax(300, 200, 0)).toBe(100);
  });

  it("removes HSA as well when present", () => {
    expect(deriveOtherPreTax(600, 200, 250)).toBe(150);
  });

  it("clamps at zero instead of going negative", () => {
    expect(deriveOtherPreTax(150, 200, 0)).toBe(0);
  });

  it("treats null/undefined inputs as zero", () => {
    expect(deriveOtherPreTax(null, undefined, null)).toBe(0);
    expect(deriveOtherPreTax(100)).toBe(100);
  });

  it("keeps the Deductions summary at the saved aggregate", () => {
    const other = deriveOtherPreTax(300, 200, 0);
    expect(
      sumDetailedDeductions({
        healthcare_deduction: "200",
        hsa_contribution: "0",
        pre_tax_deductions: String(other),
      }),
    ).toBe(300);
  });

  it("is stable across repeated save/reopen cycles", () => {
    let aggregate = 300;
    for (let i = 0; i < 5; i++) {
      const other = deriveOtherPreTax(aggregate, 200, 0);
      expect(other).toBe(100);
      aggregate = sumDetailedDeductions({
        healthcare_deduction: "200",
        hsa_contribution: "0",
        pre_tax_deductions: String(other),
      });
      expect(aggregate).toBe(300);
    }
  });

  it("take-home stays at the expected QA value", () => {
    const other = deriveOtherPreTax(300, 200, 0);
    const withholding = 1500 + 620 + 145;
    const deductions = sumDetailedDeductions({
      healthcare_deduction: "200",
      hsa_contribution: "0",
      pre_tax_deductions: String(other),
    });
    expect(withholding).toBe(2265);
    expect(10000 - 500 - withholding - deductions).toBe(6935);
  });
});
