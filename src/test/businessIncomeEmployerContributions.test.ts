/**
 * Business Activity Add/Edit Income must honor the four independent
 * company-level contribution toggles (K-1 companies such as Vituity):
 * employee/employer retirement and employee/employer HSA.
 *
 * These assertions pin the configuration surface the form reads, plus the
 * fact that the form persists four distinct columns (no collapsing of
 * employer amounts into the employee columns).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ADVANCED_FIELDS_BY_TYPE,
  TOGGLE_OPTIONS_BY_TYPE,
  resolveAdvancedVisibility,
} from "@/lib/filingTypes";

const src = readFileSync("src/pages/BusinessActivity.tsx", "utf8");

describe("K-1 contribution toggle configuration", () => {
  it("k1_partnership exposes employee and employer retirement/HSA fields", () => {
    const fields = ADVANCED_FIELDS_BY_TYPE.k1_partnership;
    expect(fields).toContain("retirement_401k");
    expect(fields).toContain("employer_retirement_contribution");
    expect(fields).toContain("hsa_contribution");
    expect(fields).toContain("employer_hsa_contribution");
  });

  it("labels the K-1 toggles as employee vs employer", () => {
    const byKey = new Map(TOGGLE_OPTIONS_BY_TYPE.k1_partnership.map((o) => [o.key, o.label]));
    expect(byKey.get("retirement_401k")).toMatch(/employee/i);
    expect(byKey.get("employer_retirement_contribution")).toMatch(/employer/i);
    expect(byKey.get("hsa_contribution")).toMatch(/employee/i);
    expect(byKey.get("employer_hsa_contribution")).toMatch(/employer/i);
  });

  it("resolves each toggle independently", () => {
    const both = resolveAdvancedVisibility("k1_partnership", {
      retirement_401k: true,
      employer_retirement_contribution: true,
      hsa_contribution: true,
      employer_hsa_contribution: true,
    });
    expect(both.retirement_401k && both.employer_retirement_contribution).toBe(true);
    expect(both.hsa_contribution && both.employer_hsa_contribution).toBe(true);

    const employerOnly = resolveAdvancedVisibility("k1_partnership", {
      retirement_401k: false,
      employer_retirement_contribution: true,
      hsa_contribution: false,
      employer_hsa_contribution: true,
    });
    expect(employerOnly.retirement_401k).toBe(false);
    expect(employerOnly.employer_retirement_contribution).toBe(true);
    expect(employerOnly.hsa_contribution).toBe(false);
    expect(employerOnly.employer_hsa_contribution).toBe(true);
  });
});

describe("Business Activity income form wiring", () => {
  it("renders a separate input for each employee/employer contribution", () => {
    for (const testId of [
      "ba-income-employee-retirement",
      "ba-income-employer-retirement",
      "ba-income-employee-hsa",
      "ba-income-employer-hsa",
    ]) {
      expect(src).toContain(testId);
    }
  });

  it("uses employee/employer labels instead of a generic retirement/HSA field", () => {
    expect(src).toContain("Employee Retirement Contribution");
    expect(src).toContain("Employer Retirement Contribution");
    expect(src).toContain("Employee HSA Contribution");
    expect(src).toContain("Employer HSA Contribution");
    expect(src).not.toContain('"Retirement / 401(k)"');
    expect(src).not.toContain(">HSA Contribution<");
  });

  it("hydrates and saves the employer columns separately from employee columns", () => {
    // hydration on reopen
    expect(src).toContain("employer_retirement_contribution: linked ? String((linked as any).employer_retirement_contribution || 0)");
    expect(src).toContain("employer_hsa_contribution: linked ? String((linked as any).employer_hsa_contribution || 0)");
    // persisted as their own columns on every save path
    const employerHsaWrites = src.match(/employer_hsa_contribution: employerHsa,/g) || [];
    const employerRetWrites = src.match(/employer_retirement_contribution: employerRetirement,/g) || [];
    expect(employerHsaWrites.length).toBeGreaterThanOrEqual(3);
    expect(employerRetWrites.length).toBeGreaterThanOrEqual(3);
    // employer amounts never folded into the employee values
    expect(src).not.toMatch(/hsa\s*\+\s*employerHsa/);
    expect(src).not.toMatch(/retirement\s*\+\s*employerRetirement/);
  });

  it("only reduces take-home by employer contributions when the company toggle is ON", () => {
    const netBlock = src.slice(src.indexOf("const calculatedNet"), src.indexOf("const calculatedNet") + 900);
    // Employer amounts are gated behind the per-company paycheck-reduction
    // toggles — never subtracted unconditionally.
    expect(netBlock).toMatch(/employerReducesPaycheck\.retirement\s*\?/);
    expect(netBlock).toMatch(/employerReducesPaycheck\.hsa\s*\?/);
    expect(netBlock).not.toMatch(/-\s*num\(incomeForm\.employer_hsa_contribution\)/);
    expect(netBlock).not.toMatch(/-\s*num\(incomeForm\.employer_retirement_contribution\)/);
  });

});
