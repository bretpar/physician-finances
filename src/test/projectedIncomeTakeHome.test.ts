import { describe, it, expect } from "vitest";

// Mirrors the take-home formula in src/pages/ProjectedIncome.tsx Edit Stream modal.
// Federal payroll tax is one bucket: prefer canonical total (taxes_withheld),
// otherwise sum federal+SS+Medicare. Do not subtract both.
function estimateTakeHome(form: {
  paycheck_amount: number;
  taxes_withheld?: number;
  federal_withholding?: number;
  ss_withholding?: number;
  medicare_withholding?: number;
  state_withholding?: number;
  retirement_401k?: number;
  healthcare_deduction?: number;
  pre_tax_deductions?: number;
}): number {
  const n = (v?: number) => Number(v || 0);
  const totalFederal = n(form.taxes_withheld) > 0
    ? n(form.taxes_withheld)
    : n(form.federal_withholding) + n(form.ss_withholding) + n(form.medicare_withholding);
  return Math.max(0,
    n(form.paycheck_amount)
    - totalFederal
    - n(form.state_withholding)
    - n(form.retirement_401k)
    - n(form.healthcare_deduction)
    - n(form.pre_tax_deductions)
  );
}

describe("Projected Income — Edit Stream take-home", () => {
  it("does not double-count when both canonical total and breakdown are present", () => {
    const result = estimateTakeHome({
      paycheck_amount: 12654,
      taxes_withheld: 2647,
      federal_withholding: 1822,
      ss_withholding: 670,
      medicare_withholding: 155,
      retirement_401k: 1443,
      healthcare_deduction: 500,
    });
    expect(result).toBe(12654 - 2647 - 1443 - 500); // 8064
  });

  it("falls back to summing breakdown when canonical total is missing", () => {
    const result = estimateTakeHome({
      paycheck_amount: 10000,
      federal_withholding: 1500,
      ss_withholding: 600,
      medicare_withholding: 145,
      retirement_401k: 500,
    });
    expect(result).toBe(10000 - (1500 + 600 + 145) - 500);
  });

  it("matches whether breakdown is collapsed or expanded", () => {
    const collapsed = estimateTakeHome({ paycheck_amount: 12654, taxes_withheld: 2647, retirement_401k: 1443, healthcare_deduction: 500 });
    const expanded = estimateTakeHome({ paycheck_amount: 12654, taxes_withheld: 2647, federal_withholding: 1822, ss_withholding: 670, medicare_withholding: 155, retirement_401k: 1443, healthcare_deduction: 500 });
    expect(collapsed).toBe(expanded);
  });
});
