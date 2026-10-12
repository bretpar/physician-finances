/**
 * Business Activity preview AND save paths must route HSA / SE health
 * insurance as federal-only deductions (never reducing SE tax), and must not
 * pass them through the business-deduction (pre-tax) channel.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/pages/BusinessActivity.tsx", "utf8");

describe("Business Activity deduction routing", () => {
  it("never folds HSA / health into preTaxDeductions on save or preview", () => {
    expect(src).not.toMatch(/preTaxDeductions:\s*preTaxDed\s*\+/);
    expect(src).not.toMatch(/preTaxDeductions:[^\n]*healthcare_deduction/);
  });
  it("save calls (add + edit) and preview all pass federalOnlyDeductions", () => {
    expect((src.match(/federalOnlyDeductions: healthcare \+ hsa/g) ?? []).length).toBe(2);
    expect(src).toMatch(/federalOnlyDeductions: num\(incomeForm\.healthcare_deduction\) \+ num\(incomeForm\.hsa_contribution\)/);
  });
  it("labels the business-level state component 'State taxes'", () => {
    expect(src).toContain('label="State taxes"');
    expect(src).not.toContain('label="State income tax"');
  });
});
