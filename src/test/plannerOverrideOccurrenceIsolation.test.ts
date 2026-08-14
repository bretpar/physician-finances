import { describe, it, expect } from "vitest";
import { format, addWeeks, parseISO } from "date-fns";
import {
  generateProjectedPaychecks,
  resolveOccurrenceDetail,
  type ProjectedIncomeStream,
  type ProjectedIncomeOverride,
} from "@/hooks/useProjectedIncome";

/**
 * Regression: editing ONE planned paycheck with the detailed breakdown expanded
 * must stay occurrence-scoped. The recurring stream defaults (and every other
 * occurrence generated from them) must be untouched.
 */

const year = new Date().getFullYear();
const START = `${year}-01-02`;

const baseStream = (): ProjectedIncomeStream => ({
  id: "stream-1",
  user_id: "u1",
  organization_id: null,
  company: "Cascade Health",
  company_type: "w2",
  pay_frequency: "biweekly",
  custom_interval_days: null,
  start_date: START,
  end_date: null,
  paycheck_amount: 8000,
  taxes_withheld: 2000,
  retirement_401k: 500,
  pre_tax_deductions: 100,
  is_active: true,
  include_in_tax: true,
  source_id: "co-1",
  ui_income_subtype: "w2_user",
  federal_withholding: 1200,
  state_withholding: 300,
  ss_withholding: 400,
  medicare_withholding: 100,
  healthcare_deduction: 250,
  hsa_contribution: 150,
  additional_tax_reserve: 50,
  notes: "",
  forecast_expense_per_period: 0,
  forecast_expense_notes: "",
  created_at: `${year}-01-01T00:00:00Z`,
  updated_at: `${year}-01-01T00:00:00Z`,
});

/** Third scheduled occurrence of the biweekly stream. */
const TARGET_DATE = format(addWeeks(parseISO(START), 4), "yyyy-MM-dd");

const detailedOverride = (): ProjectedIncomeOverride => ({
  id: "ovr-1",
  stream_id: "stream-1",
  user_id: "u1",
  organization_id: null,
  override_date: TARGET_DATE,
  new_date: null,
  action: "modify",
  paycheck_amount: 9500,
  // Detailed breakdown is the source of truth for this occurrence only.
  taxes_withheld: 1000 + 200 + 60 + 40,
  retirement_401k: 900,
  pre_tax_deductions: 75,
  has_detailed_breakdown: true,
  federal_withholding: 1000,
  state_withholding: 200,
  ss_withholding: 60,
  medicare_withholding: 40,
  healthcare_deduction: 425,
  hsa_contribution: 325,
  additional_tax_reserve: 111,
  notes: "Extra shift pay",
  created_at: `${year}-02-01T00:00:00Z`,
  updated_at: `${year}-02-01T00:00:00Z`,
});

function paychecksFor(overrides: ProjectedIncomeOverride[]) {
  const stream = baseStream();
  const all = generateProjectedPaychecks([stream], [], [], overrides, [], []);
  return { stream, all: all.filter((p) => p.streamId === "stream-1" && p.type === "paycheck") };
}

describe("detailed occurrence override isolation", () => {
  it("applies detailed values to the edited occurrence only", () => {
    const { all } = paychecksFor([detailedOverride()]);
    const edited = all.find((p) => p.date === TARGET_DATE);
    expect(edited).toBeDefined();
    expect(edited!.isModified).toBe(true);
    expect(edited!.grossAmount).toBe(9500);
    expect(edited!.taxesWithheld).toBe(1300);
    expect(edited!.retirement401k).toBe(900);
    expect(edited!.healthcareDeduction).toBe(425);
    expect(edited!.hsaContribution).toBe(325);
  });

  it("leaves every other occurrence on the recurring stream defaults", () => {
    const { all } = paychecksFor([detailedOverride()]);
    const others = all.filter((p) => p.date !== TARGET_DATE);
    expect(others.length).toBeGreaterThan(5);
    for (const p of others) {
      expect(p.isModified).toBeFalsy();
      expect(p.grossAmount).toBe(8000);
      expect(p.taxesWithheld).toBe(2000);
      expect(p.retirement401k).toBe(500);
      expect(p.preTaxDeductions).toBe(100);
      expect(p.healthcareDeduction).toBe(250);
      expect(p.hsaContribution).toBe(150);
    }
  });

  it("does not change the occurrence count or schedule", () => {
    const withOverride = paychecksFor([detailedOverride()]).all;
    const without = paychecksFor([]).all;
    expect(withOverride.length).toBe(without.length);
    expect(withOverride.map((p) => p.date)).toEqual(without.map((p) => p.date));
  });

  it("does not mutate the stream row itself", () => {
    const stream = baseStream();
    const snapshot = JSON.stringify(stream);
    generateProjectedPaychecks([stream], [], [], [detailedOverride()], [], []);
    expect(JSON.stringify(stream)).toBe(snapshot);
  });

  it("keeps stream-level detail resolution intact for unedited dates", () => {
    const stream = baseStream();
    const unedited = resolveOccurrenceDetail(stream, undefined);
    expect(unedited).toMatchObject({
      hasDetailedBreakdown: false,
      federalWithholding: 1200,
      stateWithholding: 300,
      ssWithholding: 400,
      medicareWithholding: 100,
      healthcareDeduction: 250,
      hsaContribution: 150,
      additionalTaxReserve: 50,
    });
    // …while the edited occurrence resolves to its own detailed values.
    expect(resolveOccurrenceDetail(stream, detailedOverride())).toMatchObject({
      hasDetailedBreakdown: true,
      federalWithholding: 1000,
      additionalTaxReserve: 111,
    });
  });

  it("scopes a second detailed edit to its own date without affecting the first", () => {
    const second: ProjectedIncomeOverride = {
      ...detailedOverride(),
      id: "ovr-2",
      override_date: format(addWeeks(parseISO(START), 8), "yyyy-MM-dd"),
      paycheck_amount: 7000,
      taxes_withheld: 600,
      federal_withholding: 500,
      state_withholding: 50,
      ss_withholding: 30,
      medicare_withholding: 20,
      healthcare_deduction: 0,
      hsa_contribution: 0,
      retirement_401k: 0,
    };
    const { all } = paychecksFor([detailedOverride(), second]);
    expect(all.find((p) => p.date === TARGET_DATE)!.grossAmount).toBe(9500);
    expect(all.find((p) => p.date === second.override_date)!.grossAmount).toBe(7000);
    expect(all.filter((p) => p.isModified)).toHaveLength(2);
  });

  it("moving one occurrence's date does not shift the rest of the schedule", () => {
    const moved = format(addWeeks(parseISO(TARGET_DATE), 1), "yyyy-MM-dd");
    const { all } = paychecksFor([{ ...detailedOverride(), new_date: moved }]);
    expect(all.some((p) => p.date === moved && p.isModified)).toBe(true);
    expect(all.some((p) => p.date === TARGET_DATE)).toBe(false);
    const unedited = paychecksFor([]).all.map((p) => p.date).filter((d) => d !== TARGET_DATE);
    for (const d of unedited) expect(all.some((p) => p.date === d)).toBe(true);
  });
});
