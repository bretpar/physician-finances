import { describe, it, expect } from "vitest";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";
import { k1ServiceEarnings } from "@/lib/retirementCanonicalInput";

// WWEP-shaped fixture: one Schedule C business with TWO plan kinds (Solo 401(k)
// and SEP IRA) funded from the SAME eligible earnings.
const wwep = { id: "wwep", name: "WWEP", companyType: "1099_schedule_c", employeeRole: "primary" as const };
const base = {
  taxYear: 2026,
  filingStatus: "married_filing_jointly" as const,
  companies: [wwep],
  paychecks: [],
  ira: { traditionalContributed: 0, rothContributed: 0 },
  actualNetProfitByCompany: new Map([["wwep", 100_000]]),
  includeProjection: false,
};

describe("shared same-employer retirement capacity", () => {
  it("counts employer capacity once across plans of the same business", () => {
    const view = computeRetirementRoomView({
      ...base,
      standalone: [
        { id: "s1", companyId: "wwep", accountType: "solo_401k", contributionType: "employer", annualAmount: 2_000 },
        { id: "s2", companyId: "wwep", accountType: "sep_ira", contributionType: "employer", annualAmount: 1_000 },
      ],
    });
    const plans = view.engine.plans.filter((p) => p.companyId === "wwep");
    expect(plans.map((p) => p.planKind).sort()).toEqual(["sep_ira", "solo_401k"]);
    // Each plan keeps its own attributed money and record id.
    expect(plans.find((p) => p.planKind === "solo_401k")!.employerContribution).toBe(2_000);
    expect(plans.find((p) => p.planKind === "sep_ira")!.sourceRecordIds).toEqual(["s2"]);
    const comp = plans[0].eligibleCompensation!;
    const caps = plans.map((p) => p.employerCapacityRemaining ?? 0);
    const total = caps.reduce((s, v) => s + v, 0);
    // One 20% formula on the shared earnings minus ALL employer money.
    expect(total).toBeCloseTo(comp * 0.2 - 3_000, 2);
    expect(caps.filter((c) => c > 0)).toHaveLength(1);
  });

  it("excludes capacity from the headline when two businesses may be related", () => {
    const view = computeRetirementRoomView({
      ...base,
      companies: [wwep, { id: "b2", name: "Other", companyType: "1099_schedule_c", employeeRole: "primary" }],
      actualNetProfitByCompany: new Map([["wwep", 100_000], ["b2", 50_000]]),
      standalone: [],
    });
    expect(view.engine.plans.every((p) => p.capacityUnverified)).toBe(true);
    expect(view.headline.employerVerified).toBe(0);
    expect(view.headline.needsVerificationPlanIds).toHaveLength(2);
  });

  it("keeps future recurring money out of actual and in scheduled", () => {
    const view = computeRetirementRoomView({
      ...base,
      includeProjection: true,
      standalone: [
        { id: "r1", companyId: "wwep", accountType: "solo_401k", contributionType: "employee", annualAmount: 5_000, scheduledAmount: 3_000 },
      ],
      paychecks: [
        { incomeEntryId: "planner:x:2026-12-01", companyId: "wwep", employee: 400, employer: 0, wages: 0, scheduled: true },
      ],
    });
    expect(view.engine.employee402g.contributed).toBe(5_000);
    expect(view.scheduledEmployeeTotal).toBe(3_400);
  });

  it("only treats K-1 profit as service earnings with a supporting classification", () => {
    expect(k1ServiceEarnings(null, 80_000)).toBeNull();
    expect(k1ServiceEarnings("passive", 80_000)).toBe(0);
    expect(k1ServiceEarnings("guaranteed_payments", 80_000)).toBe(80_000);
  });

  it("same-earner W-2 wages above the SS wage base shrink the half-SE-tax deduction", () => {
    const run = (w2: number) =>
      computeRetirementRoomView({
        ...base,
        standalone: [],
        w2WagesByEarner: { actual: new Map([["primary", w2]]) },
      }).engine.plans[0].eligibleCompensation!;
    expect(run(250_000)).toBeGreaterThan(run(0));
  });
});
