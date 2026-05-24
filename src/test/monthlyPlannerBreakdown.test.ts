import { describe, it, expect } from "vitest";
import {
  getMonthlyPlannerBreakdown,
  type ProjectedPaycheck,
} from "@/hooks/useProjectedIncome";

const YEAR = new Date().getFullYear();
const MAY_DATE = `${YEAR}-05-15`;

function makePaycheck(overrides: Partial<ProjectedPaycheck> = {}): ProjectedPaycheck {
  return {
    date: MAY_DATE,
    grossAmount: 2100,
    taxesWithheld: 0,
    retirement401k: 0,
    preTaxDeductions: 0,
    healthcareDeduction: 0,
    hsaContribution: 0,
    netAmount: 2100,
    type: "paycheck",
    label: "Test",
    streamId: "s1",
    matchStatus: "active",
    ...overrides,
  };
}

describe("getMonthlyPlannerBreakdown — single source-of-truth for monthly Planned", () => {
  it("counts an active unconverted entry as planned", () => {
    const result = getMonthlyPlannerBreakdown([makePaycheck()], YEAR);
    expect(result[4].plannedIncome).toBe(2100);
    expect(result[4].unconvertedPlannerIncome).toBe(2100);
  });

  it("does NOT count a converted planner occurrence as planned (acceptance: May=$0)", () => {
    const result = getMonthlyPlannerBreakdown(
      [makePaycheck({ matchStatus: "converted" })],
      YEAR,
    );
    expect(result[4].plannedIncome).toBe(0);
    expect(result[4].convertedPlannerIncome).toBe(2100);
  });

  it("does NOT count matched/suggested occurrences (prevents ledger double count)", () => {
    const result = getMonthlyPlannerBreakdown(
      [
        makePaycheck({ matchStatus: "matched" }),
        makePaycheck({ matchStatus: "suggested" }),
      ],
      YEAR,
    );
    expect(result[4].plannedIncome).toBe(0);
    expect(result[4].matchedPlannerIncome).toBe(4200);
  });

  it("does NOT count skipped/cancelled stream occurrences", () => {
    const result = getMonthlyPlannerBreakdown(
      [makePaycheck({ matchStatus: "skipped" })],
      YEAR,
    );
    expect(result[4].plannedIncome).toBe(0);
    expect(result[4].skippedPlannerIncome).toBe(2100);
  });

  it("does NOT count past_due occurrences as planned", () => {
    const result = getMonthlyPlannerBreakdown(
      [makePaycheck({ matchStatus: "past_due" })],
      YEAR,
    );
    expect(result[4].plannedIncome).toBe(0);
  });

  it("ignores entries outside the requested year", () => {
    const result = getMonthlyPlannerBreakdown(
      [makePaycheck({ date: `${YEAR - 1}-05-15` })],
      YEAR,
    );
    expect(result[4].plannedIncome).toBe(0);
  });

  it("mixed month: one active + one converted ⇒ Planned = active only", () => {
    const result = getMonthlyPlannerBreakdown(
      [
        makePaycheck({ matchStatus: "active", grossAmount: 2100 }),
        makePaycheck({ matchStatus: "converted", grossAmount: 5000 }),
      ],
      YEAR,
    );
    // Chart's "Planned" must equal the visible-active accordion total.
    expect(result[4].plannedIncome).toBe(2100);
    expect(result[4].convertedPlannerIncome).toBe(5000);
  });
});
