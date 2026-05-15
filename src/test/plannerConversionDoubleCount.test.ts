import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import {
  generateProjectedPaychecks,
  getProjectedTotals,
  type ProjectedIncomeStream,
  type MatchableBusinessTransaction,
} from "@/hooks/useProjectedIncome";

function makeStream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s-biz",
    user_id: "u1",
    organization_id: null,
    company: "Locum Co",
    company_type: "1099_schedule_c",
    pay_frequency: "single",
    custom_interval_days: null,
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: null,
    paycheck_amount: 8000,
    taxes_withheld: 0,
    retirement_401k: 0,
    pre_tax_deductions: 0,
    is_active: true,
    include_in_tax: true,
    source_id: "co-1",
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

describe("planner conversion → no double-counting in projected totals", () => {
  it("excludes a converted 1099 occurrence from projected gross when its ledger twin exists", () => {
    const stream = makeStream();

    // Ledger twin created by the planner conversion.
    const businessTx: MatchableBusinessTransaction = {
      id: "tx-1",
      transaction_date: today,
      vendor: "Locum Co",
      amount: 8000,
      source_id: "co-1",
      status: "active",
      transaction_type: "income",
      origin_type: "planner_conversion",
      origin_planner_conversion_id: "pc-1",
    };

    const conversions = [
      { stream_id: stream.id, bonus_event_id: null, occurrence_date: today, status: "converted" as const },
    ];

    const paychecks = generateProjectedPaychecks(
      [stream],
      [],
      [],
      [],
      conversions,
      [businessTx],
    );

    expect(paychecks).toHaveLength(1);
    expect(paychecks[0].matchStatus).not.toBe("active");
    expect(["converted", "matched"]).toContain(paychecks[0].matchStatus);

    // Projected totals must not count the converted occurrence.
    const totals = getProjectedTotals(paychecks, [stream]);
    expect(totals.gross || 0).toBe(0);
  });
});
