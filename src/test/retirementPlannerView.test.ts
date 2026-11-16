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
});
