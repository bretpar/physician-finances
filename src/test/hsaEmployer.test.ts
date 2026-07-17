import { describe, it, expect } from "vitest";
import {
  computeHsaContributionSummary,
  resolveHsaContributionType,
  type HsaContributionLike,
} from "@/lib/hsaComputation";

const emp = (amount: number): HsaContributionLike => ({
  amount,
  contribution_type: "employee_payroll",
  contribution_date: "2025-06-01",
});
const employer = (amount: number): HsaContributionLike => ({
  amount,
  contribution_type: "employer",
  contribution_date: "2025-06-01",
});
const ind = (amount: number): HsaContributionLike => ({
  amount,
  contribution_type: "individual",
  contribution_date: "2025-06-01",
});

describe("HSA employer contributions", () => {
  it("legacy source_type='payroll' resolves to employee_payroll", () => {
    expect(
      resolveHsaContributionType({ source_type: "payroll" }),
    ).toBe("employee_payroll");
    expect(
      resolveHsaContributionType({ source_type: "individual" }),
    ).toBe("individual");
  });

  it("prefers canonical contribution_type over legacy source_type", () => {
    expect(
      resolveHsaContributionType({
        source_type: "payroll",
        contribution_type: "employer",
      }),
    ).toBe("employer");
  });

  it("employer-only: counts toward limit, produces zero additional deduction", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [employer(2_000)],
    });
    expect(s.applicableLimit).toBe(4_300);
    expect(s.employer).toBe(2_000);
    expect(s.total).toBe(2_000);
    expect(s.remaining).toBe(2_300);
    expect(s.excess).toBe(0);
    // Employer contributions are already excluded from wages — never re-deducted.
    expect(s.deductibleEmployer).toBe(0);
    expect(s.deductibleTotal).toBe(0);
  });

  it("combined employee + employer + individual, all under the limit", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "family",
      catchUpEligible: false,
      contributions: [emp(1_000), employer(2_000), ind(1_500)],
    });
    expect(s.applicableLimit).toBe(8_550);
    expect(s.payrollEmployee).toBe(1_000);
    expect(s.employer).toBe(2_000);
    expect(s.individual).toBe(1_500);
    expect(s.total).toBe(4_500);
    expect(s.excess).toBe(0);
    // Deductible: employee payroll (already reduced wages) + individual above-line.
    // Employer never adds a second deduction.
    expect(s.deductiblePayroll).toBe(1_000);
    expect(s.deductibleIndividual).toBe(1_500);
    expect(s.deductibleEmployer).toBe(0);
    expect(s.deductibleTotal).toBe(2_500);
  });

  it("employer + individual exceed the limit: individual above-line is capped", () => {
    // family limit 2025 = 8_550
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "family",
      catchUpEligible: false,
      contributions: [employer(6_000), ind(4_000)],
    });
    expect(s.total).toBe(10_000);
    expect(s.excess).toBe(1_450);
    // Room for individual above-line = 8_550 - 6_000 employer = 2_550
    expect(s.deductibleIndividual).toBe(2_550);
    expect(s.deductibleEmployer).toBe(0);
    expect(s.deductibleTotal).toBe(2_550);
  });

  it("employer contribution alone at/over the limit fully consumes room", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [employer(5_000), ind(500)],
    });
    // limit 4_300 → individual room = max(0, 4_300 - 5_000) = 0
    expect(s.deductibleIndividual).toBe(0);
    expect(s.excess).toBe(1_200); // 5_500 - 4_300
  });

  it("mixed legacy and canonical rows sum correctly", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [
        { amount: 500, source_type: "payroll", contribution_date: "2025-01-01" }, // legacy → employee_payroll
        employer(1_000),
        { amount: 300, source_type: "individual", contribution_date: "2025-02-01" }, // legacy → individual
      ],
    });
    expect(s.payrollEmployee).toBe(500);
    expect(s.employer).toBe(1_000);
    expect(s.individual).toBe(300);
    expect(s.total).toBe(1_800);
  });

  it("employerContribution parameter is additive (backward-compat path)", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [ind(1_000)],
      employerContribution: 500,
    });
    expect(s.employer).toBe(500);
    expect(s.total).toBe(1_500);
    // Individual room = 4_300 - 500 = 3_800; individual 1_000 all deductible.
    expect(s.deductibleIndividual).toBe(1_000);
  });
});

describe("HSA employer take-home preservation (documentation test)", () => {
  it("employer HSA is not part of any employee-facing deduction total", () => {
    // Given a paycheck of $5000 with $2000 gross, $500 employee HSA, $1000 employer HSA:
    // - Take-home = gross - employee HSA - other withholding (employer HSA never subtracted)
    // - AGI reduction from HSA = only employee_payroll (already Section 125 excluded)
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [emp(500), employer(1_000)],
    });
    // Deductible total is ONLY the employee payroll amount.
    expect(s.deductibleTotal).toBe(500);
    // Both count toward the annual limit.
    expect(s.total).toBe(1_500);
  });
});
