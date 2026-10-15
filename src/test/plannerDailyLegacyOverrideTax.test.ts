import { describe, it, expect } from "vitest";
import { resolveOccurrence, ledgerFields } from "../../supabase/functions/planner-convert-daily/calc";
import { resolveOccurrenceDetail } from "@/hooks/useProjectedIncome";

const stream = {
  id: "s1", paycheck_amount: 10000, taxes_withheld: 1250, federal_withholding: 650, state_withholding: 200,
  ss_withholding: 300, medicare_withholding: 100, retirement_401k: 0, employer_retirement_contribution: 0,
  pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0, additional_tax_reserve: 0,
};
const ov = (taxes: number, extra: Record<string, number> = {}) => ({
  action: "modify", new_date: null, has_detailed_breakdown: false, paycheck_amount: 10000, taxes_withheld: taxes,
  federal_withholding: 650, state_withholding: 200, ss_withholding: 300, medicare_withholding: 100,
  retirement_401k: 0, employer_retirement_contribution: 0, pre_tax_deductions: 0, healthcare_deduction: 0,
  hsa_contribution: 0, additional_tax_reserve: 0, ...extra,
});
const run = (o?: object) => ledgerFields(resolveOccurrence(stream, o as any, "2026-03-15"), false);

describe("daily conversion tax normalization", () => {
  it("legacy state-inclusive edited paycheck → Tax 1,050, Net 7,250", () => {
    expect(run(ov(1250))).toMatchObject({ taxes_withheld: 1050, deposited_amount: 7250 });
  });
  it("current-format edited paycheck → same result", () => {
    expect(run(ov(1050))).toMatchObject({ taxes_withheld: 1050, deposited_amount: 7250 });
  });
  it("unedited recurring paycheck subtracts state once", () => {
    expect(run()).toMatchObject({ taxes_withheld: 1050, deposited_amount: 7250 });
  });
  it("aggregate-only historical paycheck keeps its total unclassified", () => {
    const r = run(ov(1250, { federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0 }));
    expect(r).toMatchObject({ taxes_withheld: 1250, federal_withholding: 0, deposited_amount: 8750 });
  });
  it("preserves retirement and employer paycheck-reduction setting", () => {
    const o = ov(1250, { retirement_401k: 500, employer_retirement_contribution: 700 });
    expect(ledgerFields(resolveOccurrence(stream, o as any, "d"), true).deposited_amount).toBe(7250 - 500 - 700);
    expect(ledgerFields(resolveOccurrence(stream, o as any, "d"), false).deposited_amount).toBe(7250 - 500);
  });
  it("retry produces identical fields", () => {
    expect(run(ov(1250))).toEqual(run(ov(1250)));
  });
  it("in-app conversion uses the same normalization", () => {
    expect(resolveOccurrenceDetail(stream as any, ov(1250) as any).taxesWithheld).toBe(1050);
  });
});
