import { describe, it, expect } from "vitest";
import { buildPlannerHistory, businessPlannerOpportunity } from "@/lib/retirementPlannerView";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";

const base = {
  taxYear: 2026, todayISO: "2026-11-16",
  companies: [{ id: "w2", companyType: "w2" }, { id: "biz", companyType: "1099_schedule_c" }],
};

describe("visual business opportunity selection", () => {
  const calculate = (companyType = "1099_schedule_c", scheduled = true) => computeRetirementRoomView({
    taxYear: 2026, companies: [{ id: "biz", name: "Practice", companyType }],
    paychecks: [], standalone: [{ id: "solo", companyId: "biz", accountType: "solo_401k", contributionType: "employer", annualAmount: 1_000, scheduledAmount: scheduled ? 2_000 : 0 }],
    ira: { traditionalContributed: 0, rothContributed: 0 }, actualNetProfitByCompany: new Map([["biz", 100_000]]),
    remainingPlannedGrossByCompany: new Map([["biz", 50_000]]), includeProjection: true,
  });
  it("selects projected canonical capacity and preserves actual versus scheduled funding", () => {
    const room = calculate();
    const result = businessPlannerOpportunity(room, "biz", true);
    expect(result.verified).toBe(true);
    expect(result.actual[0].employerContribution).toBe(1_000);
    expect(result.plans[0].employerContribution).toBe(3_000);
    expect(result.employer).toBeGreaterThan(businessPlannerOpportunity(room, "biz", false).employer ?? 0);
    expect((result.employer ?? 0) + (result.employeeShared ?? 0)).toBeLessThanOrEqual(result.plans[0].additionsHeadroom ?? 0);
  });
  it("never labels an unverified partnership plan as personally available Solo room", () => {
    const result = businessPlannerOpportunity(calculate("k1_partnership"), "biz", true);
    expect(result.verified).toBe(false);
    expect(result.employer).toBeNull();
  });
  it("does not assert a discovered default plan is a verified personal Solo account", () => {
    const room = computeRetirementRoomView({ taxYear: 2026, companies: [{ id: "biz", name: "Practice", companyType: "1099_schedule_c" }], paychecks: [], standalone: [], ira: { traditionalContributed: 0, rothContributed: 0 }, actualNetProfitByCompany: new Map([["biz", 100_000]]) });
    expect(businessPlannerOpportunity(room, "biz", true).employer).toBeNull();
  });
  it("uses WWEP's saved mixed 401k and Solo labels as one employer capacity, with unrelated status", () => {
    const room = computeRetirementRoomView({ taxYear: 2026,
      companies: [{ id: "wwep", name: "WWEP", companyType: "1099_schedule_c", retirementRelationship: { status: "unrelated" } }, { id: "vituity", name: "Vituity", companyType: "k1_partnership", k1TaxTreatment: "active_partnership", retirementRelationship: { status: "unrelated" } }],
      paychecks: [{ incomeEntryId: "paycheck", companyId: "wwep", employee: 500, employer: 0, wages: 0 }], standalone: [
        { id: "employee", companyId: "wwep", accountType: "401k", contributionType: "employee", annualAmount: 3500, scheduledAmount: 1000 },
        { id: "employer", companyId: "wwep", accountType: "401k", contributionType: "employer", annualAmount: 2000 },
        { id: "solo", companyId: "wwep", accountType: "solo_401k", contributionType: "employer", annualAmount: 2000 }],
      ira: { traditionalContributed: 0, rothContributed: 0 }, actualNetProfitByCompany: new Map([["wwep", 100000], ["vituity", 100000]]),
      remainingPlannedGrossByCompany: new Map([["wwep", 50000]]), remainingPlannedExpensesByCompany: new Map([["wwep", 10000]]), deductibleHalfSeTaxByCompany: new Map([["wwep", 0]]),
      w2WagesByEarner: { actual: new Map([["primary", 200000]]) }, includeProjection: true });
    const result = businessPlannerOpportunity(room, "wwep", true);
    expect(result.verified).toBe(true);
    expect(result.missingDetails).toEqual([]);
    expect(result.projectedProfit).toBe(140000);
    expect(result.employeeShared).toBe(19500);
    expect(result.employee).toBe(19500);
    expect(result.plans.some((p) => p.reasons.includes("payroll_plan_unresolved"))).toBe(true);
    expect(result.allocationNote).not.toBeNull();
    // Above the SS base, canonical half-SE deduction is Medicare only.
    expect(result.employer).toBeCloseTo((140000 - 140000 * .9235 * .029 / 2) * .2 - 4000, 2);
    expect(result.plans.filter((p) => (p.employerCapacityRemaining ?? 0) > 0)).toHaveLength(1);
    expect((result.employer ?? 0) + (result.employee ?? 0)).toBeLessThanOrEqual(result.plans[0].additionsHeadroom ?? 0);
    const partnership = businessPlannerOpportunity(room, "vituity", true);
    expect(partnership.plans[0].planKind).toBe("401k");
    expect(partnership.employer).toBeNull();
    expect(partnership.employerEstimate).toBeGreaterThan(0);
    expect(partnership.missingDetails).toHaveLength(1);
  });
  it("keeps unknown ownership and unresolved paycheck plans out of available capacity", () => {
    const room = computeRetirementRoomView({ taxYear: 2026,
      companies: [{ id: "a", name: "A", companyType: "1099_schedule_c" }, { id: "b", name: "B", companyType: "1099_schedule_c" }],
      paychecks: [{ incomeEntryId: "p", companyId: "a", employee: 100, employer: 50, wages: 0 }],
      standalone: [{ id: "s", companyId: "a", accountType: "solo_401k", contributionType: "employer", annualAmount: 100 }, { id: "k", companyId: "a", accountType: "sep_ira", contributionType: "employer", annualAmount: 100 }],
      ira: { traditionalContributed: 0, rothContributed: 0 }, actualNetProfitByCompany: new Map([["a", 100000], ["b", 100000]]) });
    const result = businessPlannerOpportunity(room, "a", true);
    expect(result.employer).toBeNull();
    expect(result.employee).toBeNull();
    expect(result.missingDetails.some((d) => d.includes("common ownership"))).toBe(true);
    expect(result.missingDetails.some((d) => d.includes("specific plan"))).toBe(true);
  });
});

describe("retirement planner history", () => {
  it("splits paycheck money into employee and the right employer category", () => {
    const rows = buildPlannerHistory({ ...base, scheduledPaychecks: [], standalone: [],
      paychecks: [
        { id: "p1", companyId: "w2", date: "2026-03-01", employee: 500, employer: 200 },
        { id: "p2", companyId: "biz", date: "2026-03-01", employee: 0, employer: 900 },
        { id: "old", companyId: "w2", date: "2025-12-31", employee: 999, employer: 0 },
      ] });
    expect(rows.map((r) => [r.category, r.amount])).toEqual([["employee", 500], ["w2_employer", 200], ["self_employed_employer", 900]]);
  });

  it("keeps a recurring template as one actual row and one scheduled row, never invented deposits", () => {
    const rows = buildPlannerHistory({ ...base, paychecks: [], scheduledPaychecks: [],
      standalone: [{ id: "r", companyId: null, accountType: "traditional_ira", accountLabel: "Traditional IRA", contributionType: "personal", frequency: "monthly", date: "2026-01-01", perContribution: 500, actual: 5500, scheduled: 500 }] });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => !r.scheduled)[0].amount).toBe(5500);
    expect(rows.filter((r) => r.scheduled)[0].amount).toBe(500);
    expect(rows.every((r) => r.category === "ira")).toBe(true);
  });

  it("marks future-dated recorded paychecks and Planner occurrences as scheduled and flags ambiguous ids", () => {
    const rows = buildPlannerHistory({ ...base, standalone: [], ambiguousIds: ["p1"],
      paychecks: [{ id: "p1", companyId: "w2", date: "2026-12-01", employee: 100, employer: 0 }],
      scheduledPaychecks: [{ key: "planner:s:2026-12-15", companyId: "w2", date: "2026-12-15", employee: 300, employer: 0 }] });
    expect(rows.every((r) => r.scheduled)).toBe(true);
    expect(rows.find((r) => r.recordId === "p1")?.possibleDuplicate).toBe(true);
  });

  const sep = (id: string, contributionType: string) => ({ id, companyId: "biz", accountType: "sep_ira", accountLabel: "SEP IRA", contributionType, frequency: "one_time", date: "2026-04-01", perContribution: 1000, actual: 1000, scheduled: 0 });

  it("keeps an employee-classified SEP IRA as employee money flagged for review", () => {
    const [r] = buildPlannerHistory({ ...base, paychecks: [], scheduledPaychecks: [], standalone: [sep("s1", "employee")] });
    expect(r.funding).toBe("Employee");
    expect(r.category).not.toBe("self_employed_employer");
    expect(r.reviewNote).toMatch(/Needs review/);
    expect([r.amount, r.date, r.companyId, r.accountLabel, r.editableId]).toEqual([1000, "2026-04-01", "biz", "SEP IRA", "s1"]);
  });

  it("keeps an employer-classified SEP IRA in the self-employed employer section", () => {
    const [r] = buildPlannerHistory({ ...base, paychecks: [], scheduledPaychecks: [], standalone: [sep("s2", "employer")] });
    expect([r.funding, r.category, r.amount, r.reviewNote]).toEqual(["Employer", "self_employed_employer", 1000, undefined]);
  });

  it("leaves Solo 401(k) and W-2 manual classifications unchanged", () => {
    const solo = (id: string, t: string, companyId = "biz") => ({ ...sep(id, t), companyId, accountType: "solo_401k", accountLabel: "Solo 401(k)" });
    const rows = buildPlannerHistory({ ...base, paychecks: [], scheduledPaychecks: [], standalone: [solo("a", "employee"), solo("b", "employer"), solo("c", "employer", "w2")] });
    expect(rows.map((r) => [r.recordId, r.funding, r.category, r.reviewNote])).toEqual([
      ["a", "Employee", "employee", undefined], ["b", "Employer", "self_employed_employer", undefined], ["c", "Employer", "w2_employer", undefined]]);
  });
});
