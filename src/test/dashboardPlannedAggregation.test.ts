import { describe, it, expect } from "vitest";
import {
  generateProjectedPaychecks,
  getMonthlyPlannerBreakdown,
  type ProjectedIncomeStream,
  type PlannerConversionRef,
  type ProjectedIncomeOverride,
} from "@/hooks/useProjectedIncome";

// Pick a stable future date in this calendar year so the occurrence is
// not classified as past_due regardless of when the test runs. Falls back
// to Dec 28 of the previous year only if today is literally Dec 31.
function futureDateThisYear(): string {
  const today = new Date();
  const candidate = new Date(today);
  candidate.setDate(candidate.getDate() + 14);
  // If we wrapped into next year, clamp to Dec 28 of current year.
  if (candidate.getFullYear() !== today.getFullYear()) {
    return `${today.getFullYear()}-12-28`;
  }
  const y = candidate.getFullYear();
  const m = String(candidate.getMonth() + 1).padStart(2, "0");
  const d = String(candidate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const FUTURE = futureDateThisYear();
const FUTURE_MONTH = parseInt(FUTURE.split("-")[1], 10) - 1;
const YEAR = parseInt(FUTURE.split("-")[0], 10);

function stream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "stream-1",
    user_id: "u1",
    organization_id: null,
    company: "Acme",
    company_type: "W2",
    pay_frequency: "single",
    custom_interval_days: null,
    start_date: FUTURE,
    end_date: null,
    paycheck_amount: 2100,
    taxes_withheld: 0,
    retirement_401k: 0,
    pre_tax_deductions: 0,
    is_active: true,
    include_in_tax: true,
    source_id: null,
    ui_income_subtype: null,
    federal_withholding: 0,
    state_withholding: 0,
    ss_withholding: 0,
    medicare_withholding: 0,
    healthcare_deduction: 0,
    hsa_contribution: 0,
    additional_tax_reserve: 0,
    notes: "",
    forecast_expense_per_period: 0,
    forecast_expense_notes: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("Dashboard planned aggregation parity with Income Planner accordion", () => {
  it("active stream occurrence counts as Planned and is visible", () => {
    const paychecks = generateProjectedPaychecks([stream()], [], [], [], [], []);
    const byMonth = getMonthlyPlannerBreakdown(paychecks, YEAR);
    expect(byMonth[FUTURE_MONTH].plannedIncome).toBe(2100);
    const may = paychecks.filter((p) => p.date.startsWith(`${YEAR}-${String(FUTURE_MONTH+1).padStart(2,"0")}`));
    expect(may.some((p) => p.matchStatus === "active" && p.grossAmount === 2100)).toBe(true);
  });

  it("converted occurrence does NOT count as Planned (Dashboard parity)", () => {
    const conversions: PlannerConversionRef[] = [
      { stream_id: "stream-1", bonus_event_id: null, occurrence_date: FUTURE, status: "converted" },
    ];
    const paychecks = generateProjectedPaychecks([stream()], [], [], [], conversions, []);
    const byMonth = getMonthlyPlannerBreakdown(paychecks, YEAR);
    expect(byMonth[FUTURE_MONTH].plannedIncome).toBe(0);
    expect(byMonth[FUTURE_MONTH].convertedPlannerIncome).toBe(2100);
  });

  it("skipped occurrence (via override) does NOT count as Planned", () => {
    const overrides: ProjectedIncomeOverride[] = [{
      id: "o1", stream_id: "stream-1", user_id: "u1", organization_id: null,
      override_date: FUTURE, new_date: null, action: "skip",
      paycheck_amount: 0, taxes_withheld: 0, retirement_401k: 0, pre_tax_deductions: 0,
      notes: "", created_at: "", updated_at: "",
    }];
    const paychecks = generateProjectedPaychecks([stream()], [], [], overrides, [], []);
    const byMonth = getMonthlyPlannerBreakdown(paychecks, YEAR);
    expect(byMonth[FUTURE_MONTH].plannedIncome).toBe(0);
  });

  it("inactive stream does NOT generate planned occurrences", () => {
    const paychecks = generateProjectedPaychecks(
      [stream({ is_active: false })], [], [], [], [], [],
    );
    const byMonth = getMonthlyPlannerBreakdown(paychecks, YEAR);
    expect(byMonth[FUTURE_MONTH].plannedIncome).toBe(0);
  });

  it("Dashboard chart total matches accordion 'active' total for May", () => {
    // Two streams: one active, one converted. Chart Planned must equal
    // the planner accordion's active-only total.
    const conversions: PlannerConversionRef[] = [
      { stream_id: "stream-2", bonus_event_id: null, occurrence_date: FUTURE, status: "converted" },
    ];
    const paychecks = generateProjectedPaychecks(
      [stream(), stream({ id: "stream-2", paycheck_amount: 5000 })],
      [], [], [], conversions, [],
    );
    const byMonth = getMonthlyPlannerBreakdown(paychecks, YEAR);
    const accordionActiveTotal = paychecks
      .filter((p) => p.date.startsWith(`${YEAR}-${String(FUTURE_MONTH+1).padStart(2,"0")}`) && p.matchStatus === "active")
      .reduce((s, p) => s + p.grossAmount, 0);
    expect(byMonth[FUTURE_MONTH].plannedIncome).toBe(accordionActiveTotal);
    expect(byMonth[FUTURE_MONTH].plannedIncome).toBe(2100);
  });
});
