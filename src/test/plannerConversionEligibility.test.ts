import { describe, it, expect } from "vitest";
import { format, addDays } from "date-fns";
import {
  generateProjectedPaychecks,
  type ProjectedIncomeStream,
  type MatchableBusinessTransaction,
} from "@/hooks/useProjectedIncome";

function stream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s1",
    user_id: "u1",
    organization_id: null,
    company: "Acme",
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
const future = format(addDays(new Date(), 14), "yyyy-MM-dd");

describe("planner conversion — eligibility tagging from generateProjectedPaychecks", () => {
  it("future paychecks remain 'active' (will be skipped by date filter, not reconverted)", () => {
    const s = stream({ start_date: future, paycheck_amount: 7000, company_type: "1099_schedule_c", source_id: "co-1" });
    const result = generateProjectedPaychecks([s], [], [], [], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe(future);
    expect(result[0].matchStatus).toBe("active");
  });

  it("a converted occurrence is tagged 'converted' so the runner will not re-convert it", () => {
    const s = stream({ start_date: today, paycheck_amount: 7000, company_type: "1099_schedule_c", source_id: "co-1" });
    const businessTx: MatchableBusinessTransaction = {
      id: "tx-1",
      transaction_date: today,
      vendor: "Acme",
      amount: 7000,
      source_id: "co-1",
      status: "active",
      transaction_type: "income",
      origin_type: "planner_converted",
      origin_planner_conversion_id: "pc-1",
    };
    const conversions = [
      { stream_id: s.id, bonus_event_id: null, occurrence_date: today, status: "converted" },
    ];
    const result = generateProjectedPaychecks([s], [], [], [], conversions, [businessTx]);
    expect(result).toHaveLength(1);
    expect(["converted", "matched"]).toContain(result[0].matchStatus);
  });
});
