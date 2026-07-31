import { describe, expect, it } from "vitest";
import { validatePlannedIncomeForm } from "@/pages/ProjectedIncome";

const base = {
  company: "",
  source_id: "src-1",
  source_name: "",
  source_save_as_new: false,
  source_new_kind: null,
  ui_income_subtype: "w2_user",
  pay_frequency: "biweekly",
  custom_interval_days: "14",
  start_date: "2026-08-15",
  end_date: "",
  paycheck_amount: "5000",
  taxes_withheld: "",
  federal_withholding: "",
  state_withholding: "",
  ss_withholding: "",
  medicare_withholding: "",
  total_federal_payroll_taxes: "",
  retirement_401k: "",
  healthcare_deduction: "",
  hsa_contribution: "",
  pre_tax_deductions: "",
  additional_tax_reserve: "",
  forecast_expense_per_period: "",
  forecast_expense_notes: "",
  notes: "",
  is_active: true,
  include_in_tax: true,
} as any;

const v = (o: Record<string, unknown> = {}) => validatePlannedIncomeForm({ ...base, ...o });

describe("validatePlannedIncomeForm", () => {
  it("accepts a complete entry", () => {
    expect(v()).toEqual({});
  });

  it("requires a valid date", () => {
    expect(v({ start_date: "" }).start_date).toBeTruthy();
    expect(v({ start_date: "08/15/2026" }).start_date).toBeTruthy();
  });

  it("requires a known income source", () => {
    expect(v({ ui_income_subtype: "" }).ui_income_subtype).toBeTruthy();
    expect(v({ ui_income_subtype: "not_real" }).ui_income_subtype).toBeTruthy();
  });

  it("requires a company for W-2 subtypes and any identity otherwise", () => {
    expect(v({ source_id: null }).company).toBeTruthy();
    expect(v({ source_id: null, source_name: "Acme Health" }).company).toBeUndefined();
    expect(v({ source_id: null, ui_income_subtype: "1099_schedule_c" }).company).toBeTruthy();
    expect(
      v({ source_id: null, source_name: "Acme", source_save_as_new: true, source_new_kind: null }).company,
    ).toBeTruthy();
  });

  it("validates gross income", () => {
    expect(v({ paycheck_amount: "" }).paycheck_amount).toBeTruthy();
    expect(v({ paycheck_amount: "0" }).paycheck_amount).toBeTruthy();
    expect(v({ paycheck_amount: "-100" }).paycheck_amount).toBeTruthy();
    expect(v({ paycheck_amount: "abc" }).paycheck_amount).toBeTruthy();
    expect(v({ paycheck_amount: "99999999" }).paycheck_amount).toBeTruthy();
  });

  it("validates frequency and custom interval", () => {
    expect(v({ pay_frequency: "" }).pay_frequency).toBeTruthy();
    expect(
      validatePlannedIncomeForm({ ...base, pay_frequency: "fortnight" }, { validFrequencies: ["biweekly", "single"] })
        .pay_frequency,
    ).toBeTruthy();
    expect(v({ pay_frequency: "custom", custom_interval_days: "0" }).custom_interval_days).toBeTruthy();
    expect(v({ pay_frequency: "custom", custom_interval_days: "2.5" }).custom_interval_days).toBeTruthy();
    expect(v({ pay_frequency: "custom", custom_interval_days: "400" }).custom_interval_days).toBeTruthy();
    expect(v({ pay_frequency: "custom", custom_interval_days: "30" }).custom_interval_days).toBeUndefined();
  });

  it("rejects an end date before the start date, and ignores it for one-time entries", () => {
    expect(v({ end_date: "2026-07-01" }).end_date).toBeTruthy();
    expect(v({ end_date: "2026-09-01" }).end_date).toBeUndefined();
    expect(v({ pay_frequency: "single", end_date: "2026-07-01" }).end_date).toBeUndefined();
  });
});
