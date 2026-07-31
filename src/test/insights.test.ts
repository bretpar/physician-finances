import { describe, it, expect } from "vitest";
import { buildInsights, MAX_INSIGHTS, type InsightsInput } from "@/lib/insights";

const base: InsightsInput = {
  isReady: true,
  projectedAnnualIncome: 600_000,
  annualTaxLiability: 180_000,
  savingsCoverageRatio: 1,
  stillNeedToSave: 0,
  quarterLabel: "Q3",
  deadlineLabel: "Sep 15",
  daysUntilDue: 90,
  showQuarterly: true,
  hasRetirement: true,
  hasHsa: true,
  hasHomeOffice: true,
  hasMileage: true,
  hasStudentLoanInterest: true,
  incomeChange: 0,
};

const ids = (i: InsightsInput) => buildInsights(i).map((x) => x.id);

describe("buildInsights", () => {
  it("returns nothing while data is loading", () => {
    expect(buildInsights({ ...base, isReady: false })).toEqual([]);
  });

  it("shows success when the quarter is fully covered and nothing is missing", () => {
    expect(ids(base)).toEqual(["quarterly-on-track"]);
  });

  it("surfaces overdue quarterly payment as critical", () => {
    const out = buildInsights({ ...base, savingsCoverageRatio: 0.4, stillNeedToSave: 3200, daysUntilDue: -3 });
    expect(out[0].id).toBe("quarterly-overdue");
    expect(out[0].severity).toBe("critical");
  });

  it("surfaces the deadline within 30 days", () => {
    expect(ids({ ...base, daysUntilDue: 10 })).toContain("quarterly-due-soon");
    expect(ids({ ...base, daysUntilDue: 45 })).not.toContain("quarterly-due-soon");
  });

  it("flags a significant lag against today's pace as critical", () => {
    const out = buildInsights({ ...base, savingsCoverageRatio: 0.5, stillNeedToSave: 3200 });
    const behind = out.find((i) => i.id === "tax-savings-behind");
    expect(behind?.severity).toBe("critical");
    expect(behind?.description).toContain("significantly behind");
  });

  it("downgrades an 80-95% pace to an informational nudge", () => {
    const out = buildInsights({ ...base, savingsCoverageRatio: 0.88, stillNeedToSave: 570 });
    const soft = out.find((i) => i.id === "tax-savings-slightly-behind");
    expect(soft?.severity).toBe("info");
    expect(soft?.description).toContain("$570");
    expect(out.map((i) => i.id)).not.toContain("tax-savings-behind");
  });

  it("treats 95%+ of today's pace as on track", () => {
    expect(ids({ ...base, savingsCoverageRatio: 0.96, stillNeedToSave: 120 })).toContain("quarterly-on-track");
  });

  it("auto-dismisses the shortfall once caught up", () => {
    expect(ids({ ...base, savingsCoverageRatio: 1.02, stillNeedToSave: 0 })).not.toContain("tax-savings-behind");
    expect(ids({ ...base, savingsCoverageRatio: 1.02, stillNeedToSave: 0 })).not.toContain("tax-savings-slightly-behind");
  });

  it("auto-dismisses a deduction insight once configured", () => {
    expect(ids({ ...base, hasHomeOffice: false })).toContain("home-office");
    expect(ids({ ...base, hasHomeOffice: true })).not.toContain("home-office");
  });

  it("hides quarterly insights for withholding-only users", () => {
    expect(ids({ ...base, showQuarterly: false })).toEqual([]);
  });

  it("asks for income before anything else when none exists", () => {
    const out = buildInsights({ ...base, projectedAnnualIncome: 0, hasRetirement: false, hasHsa: false });
    expect(out.map((i) => i.id)).toContain("add-income");
    expect(out.map((i) => i.id)).not.toContain("retirement");
  });

  it("surfaces significant income changes only", () => {
    expect(ids({ ...base, incomeChange: 28_000 })).toContain("income-increased");
    expect(ids({ ...base, incomeChange: -28_000 })).toContain("income-decreased");
    expect(ids({ ...base, incomeChange: 1_200 })).not.toContain("income-increased");
  });

  it("caps the list at five and keeps highest priority first", () => {
    const out = buildInsights({
      ...base,
      savingsCoverageRatio: 0.2,
      stillNeedToSave: 9000,
      daysUntilDue: -1,
      incomeChange: 30_000,
      hasRetirement: false,
      hasHsa: false,
      hasHomeOffice: false,
      hasMileage: false,
      hasStudentLoanInterest: false,
    });
    expect(out).toHaveLength(MAX_INSIGHTS);
    expect(out[0].id).toBe("quarterly-overdue");
    expect(out.map((i) => i.priority)).toEqual([...out.map((i) => i.priority)].sort((a, b) => a - b));
  });
});
