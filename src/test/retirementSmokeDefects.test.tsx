/**
 * Regression tests for the four production smoke-QA retirement defects
 * (build b3cb35d). Each exercises the SAME canonical path production uses.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";
import { RetirementRoomSummary } from "@/components/retirement/RetirementRoomSummary";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";
import { calculateSETax } from "@/lib/taxEngine";

const YEAR = 2026;

const baseArgs = {
  taxYear: YEAR,
  filingStatus: "single" as const,
  companies: [
    { id: "c-w2", name: "Optum", companyType: "w2" },
    { id: "c-1099", name: "Independent Ortho", companyType: "1099_schedule_c" },
  ],
  paychecks: [],
  standalone: [],
  ira: { traditionalContributed: 0, rothContributed: 0 },
};

/* 1 — shared employee §402(g) remainder */

describe("shared employee deferral remainder", () => {
  const view = () =>
    computeRetirementRoomView({
      ...baseArgs,
      standalone: [
        { id: "r1", companyId: "c-w2", accountType: "401k", contributionType: "employee", annualAmount: 4_500 },
        { id: "r2", companyId: "c-1099", accountType: "solo_401k", contributionType: "employee", annualAmount: 3_000 },
      ],
      actualNetProfitByCompany: new Map([["c-1099", 50_000]]),
    });

  it("computes $17,000 remaining from the canonical bucket", () => {
    const engine = view().engine;
    expect(engine.employee402g.contributed).toBe(7_500);
    expect(engine.employee402g.limit).toBe(24_500);
    expect(engine.employee402g.remaining).toBe(17_000);
  });

  it("renders $17,000 remaining in the employee card", () => {
    render(<RetirementRoomSummary room={view()} hasPlannerAccess={false} hasCapacityAccess={false} />);
    const card = screen.getByTestId("employee-room");
    expect(card.textContent).toContain("$7,500");
    expect(card.textContent).toContain("$17,000 remaining");
  });
});

/* 2 & 3 — Schedule C employer basis and projected opportunity */

describe("Schedule C employer contribution basis", () => {
  const args = {
    ...baseArgs,
    companies: [{ id: "c-1099", name: "Independent Ortho", companyType: "1099_schedule_c" }],
    actualNetProfitByCompany: new Map([["c-1099", 50_000]]),
  };

  it("uses earned income net of the deductible half of SE tax (~$9,294, not $10,000)", () => {
    const view = computeRetirementRoomView({ ...args, includeProjection: false });
    const plan = view.engine.plans.find((p) => p.companyId === "c-1099")!;
    const halfSe = calculateSETax(50_000, "single").deductibleHalf;
    expect(plan.eligibleCompensation).toBeCloseTo(50_000 - halfSe, 2);
    expect(plan.employerCapacityRemaining!).toBeCloseTo(9_293.52, 0);
    expect(plan.employerCapacityRemaining!).not.toBeCloseTo(10_000, 0);
  });

  it("projects year-end profit as YTD + future gross − future expenses and reports opportunity", () => {
    const view = computeRetirementRoomView({
      ...args,
      remainingPlannedGrossByCompany: new Map([["c-1099", 20_000]]),
      remainingPlannedExpensesByCompany: new Map([["c-1099", 5_000]]),
    });
    const projected = view.engineProjected!.plans.find((p) => p.companyId === "c-1099")!;
    const projectedProfit = 65_000; // 50,000 + 20,000 − 5,000
    const halfSe = calculateSETax(projectedProfit, "single").deductibleHalf;
    expect(projected.eligibleCompensation).toBeCloseTo(projectedProfit - halfSe, 2);
    expect(projected.employerCapacityRemaining).not.toBeNull();
    expect(projected.employerCapacityRemaining!).toBeGreaterThan(
      view.engine.plans.find((p) => p.companyId === "c-1099")!.employerCapacityRemaining!,
    );

    render(<RetirementRoomSummary room={view} hasPlannerAccess />);
    const card = screen.getAllByTestId("plan-capacity-card")[0];
    expect(card.textContent).toContain("Based on projected 2026 business profit");
  });
});

/* 4 — Solo employer deduction reaches federal tax without touching SE tax */

describe("Solo 401(k) employer deduction tax routing", () => {
  const input = (employerContribution: number): UnifiedTaxInput =>
    ({
      businessIncome: 50_000,
      seEligibleBusinessIncome: 50_000,
      businessRetirement: employerContribution,
      filingStatus: "single",
      includeProjectedIncome: false,
    }) as unknown as UnifiedTaxInput;

  it("changes federal taxable income while SE tax stays identical", () => {
    const low = computeUnifiedTaxEstimate(input(1));
    const high = computeUnifiedTaxEstimate(input(5_000));
    expect(high.estimate.taxableIncome).toBeLessThan(low.estimate.taxableIncome);
    expect(high.estimate.seTax.total).toBeCloseTo(low.estimate.seTax.total, 2);
    expect(low.estimate.seTax.total).toBeCloseTo(7_064.78, 2);
  });

  it("counts the employer contribution once in the deduction path", () => {
    const low = computeUnifiedTaxEstimate(input(1));
    const high = computeUnifiedTaxEstimate(input(5_000));
    expect(low.estimate.taxableIncome - high.estimate.taxableIncome).toBeCloseTo(4_999, 2);
  });
});
