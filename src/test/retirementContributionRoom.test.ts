import { describe, it, expect } from "vitest";
import {
  computeEmployeeContributionRoom,
  computePlanCapacities,
  getEmployeeDeferralLimit,
  getOverallPlanLimit,
  sumRemainingPlannedIncomeByCompany,
} from "@/lib/retirementContributionRoom";
import { computeRetirementSavingsSummary } from "@/lib/taxSavingsDeductions";

describe("retirement contribution room — employee elective deferrals", () => {
  it("uses the 2026 basic limit of $24,500", () => {
    expect(getEmployeeDeferralLimit(2026)).toBe(24_500);
    expect(getOverallPlanLimit(2026)).toBe(72_000);
  });

  it("A. aggregates across companies with ONE shared limit", () => {
    const r = computeEmployeeContributionRoom({
      taxYear: 2026,
      employeeContributions: [5_000, 7_500],
    });
    expect(r.employeeContributionTotal).toBe(12_500);
    expect(r.employeeDeferralLimit).toBe(24_500);
    expect(r.employeeRemainingRoom).toBe(12_000);
  });

  it("never returns negative remaining room", () => {
    const r = computeEmployeeContributionRoom({ taxYear: 2026, employeeContributions: [30_000] });
    expect(r.employeeRemainingRoom).toBe(0);
  });
});

describe("retirement contribution room — per plan capacity", () => {
  const plans = computePlanCapacities(2026, [
    {
      companyId: "a", companyName: "Company A", planType: "w2",
      eligibleCompensationYtd: 200_000, employeeContribution: 5_000, employerContribution: 0,
    },
    {
      companyId: "b", companyName: "Company B", planType: "w2",
      eligibleCompensationYtd: 150_000, employeeContribution: 7_500, employerContribution: 4_000,
    },
    {
      companyId: "c", companyName: "Company C", planType: "1099_schedule_c",
      eligibleCompensationYtd: 20_000, employeeContribution: 0, employerContribution: 3_000,
    },
    {
      companyId: "d", companyName: "Company D", planType: "1099_schedule_c",
      eligibleCompensationYtd: null, employeeContribution: 0, employerContribution: 2_000,
    },
  ]);

  it("B. employer totals sum across plans but stay attached to their own plan", () => {
    const employerTotal = plans
      .filter((p) => ["b", "c"].includes(p.companyId!))
      .reduce((s, p) => s + p.employerContribution, 0);
    expect(employerTotal).toBe(7_000);
    expect(plans.find((p) => p.companyId === "b")!.employerContribution).toBe(4_000);
    expect(plans.find((p) => p.companyId === "c")!.employerContribution).toBe(3_000);
    // Capacity is never pooled: A's unused room is independent of C's.
    expect(plans.find((p) => p.companyId === "a")!.planCurrentCapacity).toBe(72_000 - 5_000);
    expect(plans.find((p) => p.companyId === "c")!.planCurrentCapacity).toBe(20_000 - 3_000);
  });

  it("caps capacity by eligible compensation when it is below the plan limit", () => {
    const c = plans.find((p) => p.companyId === "c")!;
    expect(c.currentBasis).toBe("compensation");
  });

  it("shows no exact remaining limit when compensation is unknown", () => {
    const d = plans.find((p) => p.companyId === "d")!;
    expect(d.planCurrentCapacity).toBeNull();
    expect(d.currentBasis).toBe("unknown");
    expect(d.planContributionTotal).toBe(2_000);
  });
});

describe("retirement contribution room — Income Planner projections", () => {
  const YEAR = 2026;
  const occ = (over: Partial<{ date: string; grossAmount: number; matchStatus: string; streamSourceId: string }> = {}) => ({
    date: `${YEAR}-12-01`,
    grossAmount: 10_000,
    matchStatus: "active",
    streamSourceId: "a",
    ...over,
  });

  it("C. Current YTD uses actual income only; projected adds remaining planned income", () => {
    const planned = sumRemainingPlannedIncomeByCompany([occ()], YEAR, `${YEAR}-01-01`);
    expect(planned.get("a")).toBe(10_000);

    const [current] = computePlanCapacities(YEAR, [{
      companyId: "a", companyName: "A", eligibleCompensationYtd: 30_000,
      projectedEligibleCompensation: 30_000 + (planned.get("a") || 0),
      employeeContribution: 5_000, employerContribution: 0,
    }]);
    expect(current.planCurrentCapacity).toBe(30_000 - 5_000);
    expect(current.planProjectedCapacity).toBe(40_000 - 5_000);
  });

  it("does not double count converted/matched planned income", () => {
    const planned = sumRemainingPlannedIncomeByCompany(
      [
        occ({ matchStatus: "converted" }),
        occ({ matchStatus: "matched" }),
        occ({ matchStatus: "suggested" }),
        occ({ matchStatus: "skipped" }),
        occ({ matchStatus: "past_due" }),
      ],
      YEAR,
      `${YEAR}-01-01`,
    );
    expect(planned.get("a")).toBeUndefined();
  });

  it("ignores other tax years and already-past occurrences", () => {
    const planned = sumRemainingPlannedIncomeByCompany(
      [occ({ date: `${YEAR - 1}-12-01` }), occ({ date: `${YEAR}-01-01` })],
      YEAR,
      `${YEAR}-06-01`,
    );
    expect(planned.get("a")).toBeUndefined();
  });

  it("keeps projected capacity per company (not pooled household income)", () => {
    const planned = sumRemainingPlannedIncomeByCompany(
      [occ({ streamSourceId: "a" }), occ({ streamSourceId: "b", grossAmount: 5_000 })],
      YEAR,
      `${YEAR}-01-01`,
    );
    expect(planned.get("a")).toBe(10_000);
    expect(planned.get("b")).toBe(5_000);
  });

  it("D. projected capacity is unavailable when planner access is absent", () => {
    const [plan] = computePlanCapacities(YEAR, [{
      companyId: "a", companyName: "A", eligibleCompensationYtd: 30_000,
      projectedEligibleCompensation: null,
      employeeContribution: 5_000, employerContribution: 0,
    }]);
    expect(plan.planCurrentCapacity).toBe(25_000);
    expect(plan.planProjectedCapacity).toBeNull();
  });
});

describe("E. regression — contribution room never becomes a deduction", () => {
  it("employer dollars count toward totals but add $0 personal deduction", () => {
    const savings = computeRetirementSavingsSummary({
      standaloneAnnualizedTotal: 0,
      paycheckEmployeeTotal: 12_500,
      paycheckEmployerTotal: 7_000,
    });
    expect(savings.contributionTotal).toBe(19_500);
    expect(savings.personalDeduction).toBe(12_500);

    const room = computeEmployeeContributionRoom({ taxYear: 2026, employeeContributions: [12_500] });
    // Contribution-room math is independent of deduction math.
    expect(room.employeeContributionTotal).toBe(12_500);
    expect(room.employeeRemainingRoom).toBe(12_000);
  });
});
