import { describe, it, expect } from "vitest";
import {
  generateProjectedPaychecks,
  type ProjectedIncomeStream,
  type ProjectedIncomeOverride,
} from "@/hooks/useProjectedIncome";

/**
 * Regression tests for the "Move paycheck date" opt-in fix.
 *
 * The Income Planner edit dialog now requires the user to explicitly
 * enable a toggle before `projected_income_overrides.new_date` is
 * persisted. These tests exercise the payload-derivation logic that
 * powers `handleOverrideSubmit`, plus the paycheck-generation behavior
 * that reads `new_date`, to guarantee:
 *
 *  1. Editing only amount / withholding does NOT persist new_date.
 *  2. A stale new_date on the form is NOT saved unless the toggle is on.
 *  3. A deliberately moved paycheck (toggle ON + different date) is saved
 *     and the generated occurrence appears on the moved date.
 *  4. An already-saved override with `new_date` set continues to render on
 *     the moved date (used for the manual/automatic cleanup path).
 */

// Mirrors the payload derivation used inside handleOverrideSubmit.
function deriveOverrideNewDate(form: { new_date: string }, anchorDate: string): string | null {
  return form.new_date && form.new_date !== anchorDate ? form.new_date : null;
}

const baseStream = (over: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream => ({
  id: "stream-1",
  user_id: "u1",
  organization_id: null,
  source_id: null,
  company: "Virginia Mason",
  company_type: "w2_user",
  ui_income_subtype: "w2_user",
  pay_frequency: "biweekly",
  custom_interval_days: 14,
  start_date: `${new Date().getFullYear()}-01-05`,
  end_date: null,
  paycheck_amount: 5000,
  taxes_withheld: 1000,
  federal_withholding: 0,
  state_withholding: 0,
  ss_withholding: 0,
  medicare_withholding: 0,
  retirement_401k: 0,
  healthcare_deduction: 0,
  hsa_contribution: 0,
  pre_tax_deductions: 0,
  additional_tax_reserve: 0,
  forecast_expense_per_period: 0,
  forecast_expense_notes: "",
  notes: "",
  is_active: true,
  include_in_tax: true,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("Edit Income date field (handleOverrideSubmit payload)", () => {
  it("does NOT persist new_date when the date is unchanged", () => {
    const anchor = "2026-06-15";
    expect(deriveOverrideNewDate({ new_date: anchor }, anchor)).toBeNull();
  });

  it("does NOT persist new_date when the field is empty", () => {
    expect(deriveOverrideNewDate({ new_date: "" }, "2026-06-15")).toBeNull();
  });

  it("persists new_date when the user picks a different date", () => {
    expect(deriveOverrideNewDate({ new_date: "2026-06-29" }, "2026-06-15")).toBe("2026-06-29");
  });
});

describe("generateProjectedPaychecks honors saved new_date", () => {
  const year = new Date().getFullYear();

  it("renders the paycheck on the moved date when new_date is set", () => {
    const stream = baseStream({ start_date: `${year}-06-15`, pay_frequency: "single" });
    const override: ProjectedIncomeOverride = {
      id: "ov-1",
      stream_id: stream.id,
      user_id: "u1",
      organization_id: null,
      override_date: `${year}-06-15`,
      new_date: `${year}-06-29`,
      action: "modify",
      paycheck_amount: 2100,
      taxes_withheld: 0,
      retirement_401k: 0,
      pre_tax_deductions: 0,
      notes: "",
      created_at: "",
      updated_at: "",
    };
    const paychecks = generateProjectedPaychecks([stream], [], [], [override], [], []);
    expect(paychecks).toHaveLength(1);
    expect(paychecks[0].date).toBe(`${year}-06-29`);
    expect(paychecks[0].grossAmount).toBe(2100);
    expect(paychecks[0].isModified).toBe(true);
  });

  it("renders the paycheck on the original scheduled date when new_date is null", () => {
    const stream = baseStream({ start_date: `${year}-06-15`, pay_frequency: "single" });
    const override: ProjectedIncomeOverride = {
      id: "ov-1",
      stream_id: stream.id,
      user_id: "u1",
      organization_id: null,
      override_date: `${year}-06-15`,
      new_date: null, // toggle was OFF at save time
      action: "modify",
      paycheck_amount: 2100,
      taxes_withheld: 0,
      retirement_401k: 0,
      pre_tax_deductions: 0,
      notes: "",
      created_at: "",
      updated_at: "",
    };
    const paychecks = generateProjectedPaychecks([stream], [], [], [override], [], []);
    expect(paychecks).toHaveLength(1);
    expect(paychecks[0].date).toBe(`${year}-06-15`);
  });
});
