import { describe, it, expect } from "vitest";
import { buildOverrideFinancials, overrideTakeHome } from "@/pages/ProjectedIncome";
import { generateProjectedPaychecks, resolveOccurrenceDetail, type ProjectedIncomeStream, type ProjectedIncomeOverride } from "@/hooks/useProjectedIncome";
import { buildOccurrenceLedgerFields } from "@/lib/plannerOccurrenceLedger";

const form = {
  paycheck_amount: "10000", detailed: true, tax_classified: true, taxes_withheld: "",
  federal_withholding: "600", state_withholding: "200", ss_withholding: "300", medicare_withholding: "100",
  retirement_401k: "500", employer_retirement_contribution: "700", healthcare_deduction: "", hsa_contribution: "",
  pre_tax_deductions: "", additional_tax_reserve: "",
};

describe("override tax summary and cash", () => {
  it("Fed 600 / State 200 / SS 300 / Medicare 100 → Tax 1,000", () => {
    expect(buildOverrideFinancials(form).taxes_withheld).toBe(1000);
  });
  it("600 → 650 → 600 keeps summary and cash", () => {
    const before = overrideTakeHome(form, false);
    expect(buildOverrideFinancials({ ...form, federal_withholding: "650" }).taxes_withheld).toBe(1050);
    const back = { ...form, federal_withholding: "600" };
    expect(buildOverrideFinancials(back).taxes_withheld).toBe(1000);
    expect(overrideTakeHome(back, false)).toBe(before);
  });
  it("state deducted once from cash", () => {
    expect(overrideTakeHome(form, false)).toBe(10000 - 1000 - 200 - 500);
  });
  it("aggregate-only stays unclassified", () => {
    const agg = buildOverrideFinancials({ ...form, tax_classified: false, detailed: false, taxes_withheld: "900",
      federal_withholding: "", state_withholding: "", ss_withholding: "", medicare_withholding: "" });
    expect(agg).toMatchObject({ taxes_withheld: 900, federal_withholding: 0, has_detailed_breakdown: false });
  });
});

const year = new Date().getFullYear();
const stream = (fed: number): ProjectedIncomeStream => ({
  id: "s1", user_id: "u", organization_id: null, company: "Co", company_type: "k1", pay_frequency: "monthly",
  custom_interval_days: null, start_date: `${year}-01-15`, end_date: null, paycheck_amount: 10000,
  taxes_withheld: fed + 400, retirement_401k: 500, pre_tax_deductions: 0, is_active: true, include_in_tax: true,
  source_id: null, ui_income_subtype: null, federal_withholding: fed, state_withholding: 200, ss_withholding: 300,
  medicare_withholding: 100, healthcare_deduction: 0, hsa_contribution: 0, additional_tax_reserve: 0, notes: "",
  forecast_expense_per_period: 0, forecast_expense_notes: "", created_at: "", updated_at: "",
} as any);
// Employer-retirement-only edit (no detailed flag) saved with the full snapshot.
const ov = { id: "o", stream_id: "s1", user_id: "u", organization_id: null, override_date: `${year}-03-15`,
  new_date: null, action: "modify", paycheck_amount: 10000, ...buildOverrideFinancials({ ...form, detailed: false }),
  notes: "", created_at: "", updated_at: "" } as unknown as ProjectedIncomeOverride;

describe("occurrence snapshot", () => {
  it("edited occurrence keeps its snapshot after a parent federal change", () => {
    const d = resolveOccurrenceDetail(stream(700), ov);
    expect(d.federalWithholding).toBe(600);
    const p = generateProjectedPaychecks([stream(700)], [], [], [ov], [], []).find((x) => x.date === ov.override_date)!;
    expect(p.taxesWithheld).toBe(1000);
    expect(p.netAmount).toBe(10000 - 1000 - 200 - 500);
  });
  it("unedited occurrences follow the stream", () => {
    const p = generateProjectedPaychecks([stream(700)], [], [], [ov], [], []).find((x) => x.date === `${year}-04-15`)!;
    expect(p.federalWithholding).toBe(700);
    expect(p.taxesWithheld).toBe(1100);
  });
  it("converted income uses the same snapshot without duplicate deductions", () => {
    const d = resolveOccurrenceDetail(stream(700), ov);
    const led = buildOccurrenceLedgerFields({ grossAmount: 10000, taxesWithheld: ov.taxes_withheld, retirement401k: 500,
      employerRetirementContribution: 700, preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0,
      federalWithholding: d.federalWithholding, stateWithholding: d.stateWithholding, stateSeparate: true });
    expect(led).toMatchObject({ taxes_withheld: 1000, federal_withholding: 600, state_withholding: 200, deposited_amount: 8300 });
  });
});
