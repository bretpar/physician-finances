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

describe("final focused retirement corrections", () => {
  const w2 = { id: "w2", name: "Hospital", companyType: "w2", employeeRole: "primary" as const };
  it("projected employee room subtracts scheduled deferrals once ($20k + $4k of $24.5k → $500)", () => {
    const view = computeRetirementRoomView({
      ...base, companies: [w2], actualNetProfitByCompany: new Map(), includeProjection: true, standalone: [],
      paychecks: [
        { incomeEntryId: "e1", companyId: "w2", employee: 20_000, employer: 0, wages: 300_000 },
        { incomeEntryId: "planner:s:2026-12-15", companyId: "w2", employee: 4_000, employer: 0, wages: 20_000, scheduled: true },
      ],
    });
    expect(view.engine.employee402g.remaining).toBe(4_500);
    expect(view.engineProjected!.employee402g.remaining).toBe(500);
    expect(view.headline.employeeRoom).toBe(500);
  });

  it("caps employee room by eligible compensation", () => {
    const view = computeRetirementRoomView({
      ...base, companies: [w2], actualNetProfitByCompany: new Map(), standalone: [],
      paychecks: [{ incomeEntryId: "e1", companyId: "w2", employee: 1_000, employer: 0, wages: 5_000 }],
    });
    expect(view.engine.employee402g.remaining).toBe(4_000);
  });

  it("never emits duplicate plan ids and is order-independent", () => {
    const rows = [
      { id: "a", companyId: "wwep", accountType: "solo_401k", contributionType: "employer", annualAmount: 2_000 },
      { id: "b", companyId: "wwep", accountType: "sep_ira", contributionType: "employer", annualAmount: 1_000 },
    ];
    const paychecks = [{ incomeEntryId: "p1", companyId: "wwep", employee: 500, employer: 0, wages: 0 }];
    const run = (st: typeof rows) => computeRetirementRoomView({ ...base, standalone: st, paychecks }).engine.plans;
    const plans = run(rows);
    const ids = plans.map((p) => p.planId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plans.find((p) => p.reasons.includes("payroll_plan_unresolved"))?.employeeContribution).toBe(500);
    const caps = (ps: typeof plans) => ps.map((p) => [p.planId, p.employerCapacityRemaining]);
    expect(caps(run([...rows].reverse()))).toEqual(caps(plans));
    // Single explicit plan + payroll → one merged plan id.
    const one = run([rows[0]]).filter((p) => p.companyId === "wwep");
    expect(one).toHaveLength(1);
    expect(one[0].sourceRecordIds).toEqual(["a", "p1"]);
  });

  it("flags related-business uncertainty even when the other business has $0 capacity", () => {
    const view = computeRetirementRoomView({
      ...base,
      companies: [wwep, { id: "b2", name: "Other", companyType: "1099_schedule_c", employeeRole: "primary" }],
      actualNetProfitByCompany: new Map([["wwep", 100_000], ["b2", 0]]),
      standalone: [],
    });
    const w = view.engine.plans.find((p) => p.companyId === "wwep")!;
    expect(w.capacityUnverified).toBe(true);
    expect(view.headline.employerVerified).toBe(0);
  });

  it("a future $1,000 IRA contribution is $0 actual and $1,000 scheduled", () => {
    const view = computeRetirementRoomView({
      ...base, includeProjection: true, standalone: [],
      ira: { traditionalContributed: 0, rothContributed: 0 },
      iraScheduled: { traditionalContributed: 0, rothContributed: 1_000 },
    });
    expect(view.engine.ira.combinedContributed).toBe(0);
    expect(view.scheduledIraTotal).toBe(1_000);
    expect(view.engineProjected!.ira.combinedContributed).toBe(1_000);
  });

  it("warns when a K-1's service-income classification is unknown", () => {
    const view = computeRetirementRoomView({
      ...base, standalone: [],
      companies: [{ id: "k1", name: "Partners", companyType: "k1_partnership", employeeRole: "primary" }],
    });
    expect(view.k1ClassificationUnknownCompanyIds).toEqual(["k1"]);
    expect(view.needsReconciliation).toBe(true);
  });
});
