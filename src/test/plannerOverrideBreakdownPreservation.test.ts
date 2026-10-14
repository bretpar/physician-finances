/**
 * P0: single-paycheck Edit Income must never erase or reclassify withholding /
 * deduction details because the breakdown panel was opened or closed.
 * `buildOverrideFinancials` has no knowledge of panel state — these tests pin that
 * saved values depend only on form data.
 */
import { describe, it, expect } from "vitest";
import { buildOverrideFinancials } from "@/pages/ProjectedIncome";

const classified = {
  detailed: true, tax_classified: true,
  taxes_withheld: "1200", federal_withholding: "600", state_withholding: "200",
  ss_withholding: "300", medicare_withholding: "100",
  retirement_401k: "500", employer_retirement_contribution: "750",
  healthcare_deduction: "250", hsa_contribution: "150", pre_tax_deductions: "50",
  additional_tax_reserve: "400",
};

describe("override breakdown preservation", () => {
  it("open → close → save with no changes keeps every component", () => {
    const saved = buildOverrideFinancials(classified);
    expect(saved).toMatchObject({
      taxes_withheld: 1000, federal_withholding: 600, state_withholding: 200,
      ss_withholding: 300, medicare_withholding: 100, retirement_401k: 500,
      employer_retirement_contribution: 750, healthcare_deduction: 250,
      hsa_contribution: 150, pre_tax_deductions: 450, additional_tax_reserve: 400,
      has_detailed_breakdown: true,
    });
  });

  it("editing employer retirement leaves withholding untouched", () => {
    const saved = buildOverrideFinancials({ ...classified, employer_retirement_contribution: "1000" });
    expect(saved.employer_retirement_contribution).toBe(1000);
    expect(saved.retirement_401k).toBe(500);
    expect([saved.federal_withholding, saved.state_withholding, saved.ss_withholding, saved.medicare_withholding])
      .toEqual([600, 200, 300, 100]);
  });

  it("aggregate-only tax edit is saved as aggregate, never assigned to federal", () => {
    const saved = buildOverrideFinancials({
      ...classified, detailed: false, tax_classified: false, taxes_withheld: "900",
      federal_withholding: "", state_withholding: "", ss_withholding: "", medicare_withholding: "",
      healthcare_deduction: "", hsa_contribution: "", additional_tax_reserve: "",
    });
    expect(saved.taxes_withheld).toBe(900);
    expect(saved.federal_withholding).toBe(0);
    expect(saved.has_detailed_breakdown).toBe(false);
  });

  it("single classified component edit updates the Tax total from components", () => {
    const saved = buildOverrideFinancials({ ...classified, state_withholding: "300" });
    expect(saved.taxes_withheld).toBe(1000);
    expect(saved.federal_withholding).toBe(600);
  });

  it("hidden employer contribution is preserved", () => {
    expect(buildOverrideFinancials(classified).employer_retirement_contribution).toBe(750);
  });

  it("inherited stream components without classification keep the stream aggregate", () => {
    // Non-detailed occurrence hydrated with stream splits; user edits only HSA.
    const saved = buildOverrideFinancials({
      ...classified, detailed: true, tax_classified: false, taxes_withheld: "1000",
    });
    expect(saved.taxes_withheld).toBe(1000);
  });

  it("historical aggregate-only withholding stays aggregate when reserve is edited", () => {
    const saved = buildOverrideFinancials({
      ...classified, detailed: true, tax_classified: false, taxes_withheld: "800",
      federal_withholding: "", state_withholding: "", ss_withholding: "", medicare_withholding: "",
      additional_tax_reserve: "500",
    });
    expect(saved.taxes_withheld).toBe(800);
    expect(saved.federal_withholding).toBe(0);
    expect(saved.additional_tax_reserve).toBe(500);
  });

  it("preserves HSA, health insurance, other deductions and reserve without a detailed flag", () => {
    const saved = buildOverrideFinancials({ ...classified, detailed: false, tax_classified: false });
    expect(saved.healthcare_deduction).toBe(250);
    expect(saved.hsa_contribution).toBe(150);
    expect(saved.pre_tax_deductions).toBe(50);
    expect(saved.additional_tax_reserve).toBe(400);
  });
});
