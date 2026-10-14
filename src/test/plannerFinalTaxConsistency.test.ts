import { describe, it, expect } from "vitest";
import { splitStreamTax, buildOccurrenceLedgerFields } from "@/lib/plannerOccurrenceLedger";
import { generateProjectedPaychecks, resolveOccurrenceDetail, type ProjectedIncomeStream } from "@/hooks/useProjectedIncome";

const year = new Date().getFullYear();
const stream = (over: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream => ({
  id: "s1", user_id: "u", organization_id: null, company: "Co", company_type: "w2", pay_frequency: "monthly",
  custom_interval_days: null, start_date: `${year}-01-15`, end_date: null, paycheck_amount: 10000,
  taxes_withheld: 1000, retirement_401k: 500, pre_tax_deductions: 0, is_active: true, include_in_tax: true,
  source_id: null, ui_income_subtype: null, federal_withholding: 600, state_withholding: 200, ss_withholding: 300,
  medicare_withholding: 100, healthcare_deduction: 0, hsa_contribution: 0, additional_tax_reserve: 0, notes: "",
  forecast_expense_per_period: 0, forecast_expense_notes: "", created_at: "", updated_at: "", ...over,
} as any);
const jan = (s: ProjectedIncomeStream, reduces?: boolean) =>
  generateProjectedPaychecks([s], [], [], [], [], [], reduces ? { s1: true } : undefined).find((p) => p.date === `${year}-01-15`)!;

describe("unedited stream Tax = federal + SS + Medicare", () => {
  it("current stream total: Tax 1,000, state deducted once", () => {
    const p = jan(stream());
    expect(p.taxesWithheld).toBe(1000);
    expect(p.netAmount).toBe(10000 - 1000 - 200 - 500);
  });
  it("legacy total including state: same Tax and same take-home", () => {
    const p = jan(stream({ taxes_withheld: 1200 }));
    expect(p.taxesWithheld).toBe(1000);
    expect(p.netAmount).toBe(8300);
  });
  it("aggregate-only stream stays unclassified", () => {
    const s = { taxes_withheld: 900, federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0 };
    expect(splitStreamTax(s)).toEqual({ taxesWithheld: 900, stateSeparate: false });
    expect(jan(stream(s)).netAmount).toBe(10000 - 900 - 500);
  });
  it("employer contribution setting ON/OFF", () => {
    const s = stream({ employer_retirement_contribution: 700 } as any);
    expect(jan(s).netAmount).toBe(8300);
    expect(jan(s, true).netAmount).toBe(7600);
  });
  it("conversion uses the same Tax and Net Received as the planner", () => {
    const s = stream({ taxes_withheld: 1200 });
    const d = resolveOccurrenceDetail(s, null);
    const led = buildOccurrenceLedgerFields({ grossAmount: 10000, taxesWithheld: d.taxesWithheld, retirement401k: 500,
      preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0, federalWithholding: d.federalWithholding,
      stateWithholding: d.stateWithholding, stateSeparate: d.stateSeparate });
    expect(led).toMatchObject({ taxes_withheld: 1000, state_withholding: 200, deposited_amount: jan(s).netAmount });
  });
});
