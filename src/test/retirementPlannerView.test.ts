import { describe, it, expect } from "vitest";
import { buildPlannerHistory } from "@/lib/retirementPlannerView";

const base = {
  taxYear: 2026, todayISO: "2026-11-16",
  companies: [{ id: "w2", companyType: "w2" }, { id: "biz", companyType: "1099_schedule_c" }],
};

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
