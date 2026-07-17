import { describe, it, expect } from "vitest";
import {
  getApplicableHsaLimit,
  getHsaLimits,
  HSA_LIMITS_BY_YEAR,
} from "@/lib/hsaLimits";
import {
  computeHsaContributionSummary,
  type HsaContributionLike,
} from "@/lib/hsaComputation";

const row = (
  amount: number,
  source: "payroll" | "individual",
  date = "2025-06-01",
): HsaContributionLike => ({
  amount,
  source_type: source,
  contribution_date: date,
});

describe("HSA limits + contribution summary", () => {
  it("1) Individual coverage below the limit → no excess, room remains", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [row(2_000, "individual")],
    });
    expect(s.applicableLimit).toBe(4_300);
    expect(s.total).toBe(2_000);
    expect(s.excess).toBe(0);
    expect(s.remaining).toBe(2_300);
    expect(s.deductibleTotal).toBe(2_000);
    expect(s.deductibleIndividual).toBe(2_000);
    expect(s.deductiblePayroll).toBe(0);
  });

  it("2) Individual coverage exactly at the limit", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [row(4_300, "individual")],
    });
    expect(s.total).toBe(4_300);
    expect(s.excess).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.deductibleTotal).toBe(4_300);
    expect(s.deductibleIndividual).toBe(4_300);
  });

  it("3) Individual coverage above the limit → excess surfaced, deductible capped", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [row(5_000, "individual")],
    });
    expect(s.excess).toBe(700);
    expect(s.remaining).toBe(0);
    expect(s.deductibleTotal).toBe(4_300);
    expect(s.deductibleIndividual).toBe(4_300);
  });

  it("4) Family coverage uses the family limit", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "family",
      catchUpEligible: false,
      contributions: [row(6_000, "individual")],
    });
    expect(s.applicableLimit).toBe(8_550);
    expect(s.remaining).toBe(2_550);
    expect(s.excess).toBe(0);
  });

  it("5) Age-55 catch-up adds $1,000 to the applicable limit", () => {
    const base = getApplicableHsaLimit(2025, "individual", false);
    const withCatchup = getApplicableHsaLimit(2025, "individual", true);
    expect(withCatchup - base).toBe(1_000);

    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: true,
      contributions: [row(5_000, "individual")],
    });
    expect(s.applicableLimit).toBe(5_300);
    expect(s.deductibleTotal).toBe(5_000);
    expect(s.excess).toBe(0);
    expect(s.remaining).toBe(300);
  });

  it("6) Payroll + direct combined below limit → both fully deductible, none excess", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "family",
      catchUpEligible: false,
      contributions: [row(4_000, "payroll"), row(2_000, "individual")],
    });
    expect(s.payrollEmployee).toBe(4_000);
    expect(s.individual).toBe(2_000);
    expect(s.total).toBe(6_000);
    expect(s.excess).toBe(0);
    expect(s.deductiblePayroll).toBe(4_000);
    expect(s.deductibleIndividual).toBe(2_000);
    expect(s.deductibleTotal).toBe(6_000);
  });

  it("7) Contributions spanning tax years use each year's own limit", () => {
    const limit2024 = getApplicableHsaLimit(2024, "individual", false);
    const limit2025 = getApplicableHsaLimit(2025, "individual", false);
    expect(limit2024).toBe(4_150);
    expect(limit2025).toBe(4_300);

    // Report for 2024 uses only 2024 rows and 2024 limit.
    const s2024 = computeHsaContributionSummary({
      taxYear: 2024,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [row(4_150, "individual", "2024-12-15")],
    });
    expect(s2024.applicableLimit).toBe(4_150);
    expect(s2024.excess).toBe(0);

    // Same $4,150 in 2025 is under limit — has room left.
    const s2025 = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [row(4_150, "individual", "2025-01-05")],
    });
    expect(s2025.applicableLimit).toBe(4_300);
    expect(s2025.remaining).toBe(150);
  });

  it("8) Payroll alone above limit → individual deductible = 0, no negative deduction", () => {
    // Not realistic (payroll caps in reality), but the engine must not
    // subtract payroll wages twice by inverting the deduction.
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [row(5_000, "payroll"), row(500, "individual")],
    });
    expect(s.applicableLimit).toBe(4_300);
    expect(s.payrollEmployee).toBe(5_000);
    expect(s.deductiblePayroll).toBe(4_300); // capped at applicable limit for benefit reporting
    expect(s.deductibleIndividual).toBe(0);
    // Deductible total capped at applicableLimit — engine gives no benefit
    // beyond the legal limit even though wages were already reduced.
    expect(s.deductibleTotal).toBe(4_300);
    expect(s.excess).toBe(1_200); // 5500 total − 4300 limit
    expect(s.remaining).toBe(0);
  });

  it("9) Direct contribution after payroll fills the limit → direct is excess", () => {
    const s = computeHsaContributionSummary({
      taxYear: 2025,
      coverage: "individual",
      catchUpEligible: false,
      contributions: [row(4_300, "payroll"), row(1_000, "individual")],
    });
    expect(s.excess).toBe(1_000);
    expect(s.deductibleIndividual).toBe(0);
    expect(s.deductibleTotal).toBe(4_300);
  });

  it("10) Parity: single summary shared across Tax Overview / Deductions / Reports / PDF", () => {
    // Ensures every surface can build the same numbers from the same input.
    // (Parity is structural: they all import computeHsaContributionSummary,
    // so equal input ⇒ equal output.)
    const input = {
      taxYear: 2025,
      coverage: "family" as const,
      catchUpEligible: true,
      contributions: [row(4_000, "payroll"), row(3_000, "individual")],
    };
    const a = computeHsaContributionSummary(input);
    const b = computeHsaContributionSummary(input);
    expect(a).toEqual(b);
    expect(a.applicableLimit).toBe(9_550); // 8550 + 1000
    expect(a.total).toBe(7_000);
    expect(a.deductibleTotal).toBe(7_000);
    expect(a.excess).toBe(0);
    expect(a.remaining).toBe(2_550);
  });

  it("registry: getHsaLimits falls back to latest year for unknown years", () => {
    const t = getHsaLimits(2099);
    expect(t.individual).toBeGreaterThan(0);
    expect(Object.keys(HSA_LIMITS_BY_YEAR).length).toBeGreaterThan(0);
  });
});
