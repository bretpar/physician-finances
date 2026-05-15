import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import {
  generateProjectedPaychecks,
  type ProjectedIncomeStream,
  type MatchableIncomeEntry,
} from "@/hooks/useProjectedIncome";

function makeStream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s1",
    user_id: "u1",
    organization_id: null,
    company: "Acme Hospital",
    company_type: "w2",
    pay_frequency: "single",
    custom_interval_days: null,
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: null,
    paycheck_amount: 5000,
    taxes_withheld: 1000,
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

const today = format(new Date(), "yyyy-MM-dd");

describe("projected paycheck matching — heuristic vs confirmed", () => {
  it("returns 'suggested' (not 'matched') when only a heuristic candidate exists", () => {
    const stream = makeStream();
    const entry: MatchableIncomeEntry = {
      id: "ie-1",
      income_date: today,
      company: "Acme Hospital",
      paycheck_amount: 4800, // close but not exact net
      income_type: "w2",
      status: "received",
      // no entry_kind / origin_planner_conversion_id → no stored link
    };

    const result = generateProjectedPaychecks([stream], [], [entry], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].matchStatus).toBe("suggested");
    expect(result[0].suggestedIncomeId).toBe("ie-1");
    expect(result[0].matchedIncomeId).toBeUndefined();
  });

  it("returns 'matched' only when the income entry came from a confirmed planner conversion", () => {
    const stream = makeStream();
    const entry: MatchableIncomeEntry = {
      id: "ie-2",
      income_date: today,
      company: "Acme Hospital",
      paycheck_amount: 4800,
      income_type: "w2",
      status: "received",
      entry_kind: "planner_conversion",
    };

    const result = generateProjectedPaychecks([stream], [], [entry], [], []);
    expect(result[0].matchStatus).toBe("matched");
    expect(result[0].matchedIncomeId).toBe("ie-2");
  });

  it("also treats origin_planner_conversion_id as a confirmed link", () => {
    const stream = makeStream();
    const entry: MatchableIncomeEntry = {
      id: "ie-3",
      income_date: today,
      company: "Acme Hospital",
      paycheck_amount: 4800,
      income_type: "w2",
      status: "received",
      origin_planner_conversion_id: "pc-1",
    };

    const result = generateProjectedPaychecks([stream], [], [entry], [], []);
    expect(result[0].matchStatus).toBe("matched");
  });
});
