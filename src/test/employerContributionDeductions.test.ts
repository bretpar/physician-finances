import { describe, it, expect } from "vitest";
import { computeRetirementSavingsSummary } from "@/lib/taxSavingsDeductions";
import { computeHsaContributionSummary } from "@/lib/hsaComputation";

describe("employer contributions vs personal deduction", () => {
  it("retirement: employee 12,500 + employer 7,000 → 19,500 total, 12,500 deduction", () => {
    const r = computeRetirementSavingsSummary({
      standaloneAnnualizedTotal: 0,
      paycheckEmployeeTotal: 12_500,
      paycheckEmployerTotal: 7_000,
    });
    expect(r.contributionTotal).toBe(19_500);
    expect(r.personalDeduction).toBe(12_500);
  });

  it("HSA: employee 2,000 + employer 1,500 → 3,500 total, 2,000 deduction", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2026,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [
        { amount: 2000, source_type: "payroll", contribution_type: "employee_payroll", contribution_date: "2026-03-01" },
        { amount: 1500, source_type: "payroll", contribution_type: "employer", contribution_date: "2026-03-01" },
      ],
    });
    expect(s.total).toBe(3500);
    expect(s.deductibleTotal).toBe(2000);
  });
});
