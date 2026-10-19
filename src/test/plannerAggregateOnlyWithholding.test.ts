import { describe, it, expect } from "vitest";
import { resolveOccurrence, ledgerFields } from "../../supabase/functions/planner-convert-daily/calc";
import { resolveOccurrenceDetail } from "@/hooks/useProjectedIncome";
import { buildOccurrenceLedgerFields } from "@/lib/plannerOccurrenceLedger";

const stream = {
  id: "s1", paycheck_amount: 10000, taxes_withheld: 1200, federal_withholding: 600, state_withholding: 200,
  ss_withholding: 300, medicare_withholding: 100, retirement_401k: 0, employer_retirement_contribution: 0,
  pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0, additional_tax_reserve: 0,
};
const base = {
  action: "modify", new_date: null, paycheck_amount: 10000, retirement_401k: 0, employer_retirement_contribution: 0,
  pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0, additional_tax_reserve: 0,
};
const aggOnly = { ...base, has_detailed_breakdown: false, taxes_withheld: 500,
  federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0 };
const detailed = { ...base, has_detailed_breakdown: true, taxes_withheld: 700,
  federal_withholding: 450, state_withholding: 50, ss_withholding: 200, medicare_withholding: 50 };

const daily = (ov?: object) => ledgerFields(resolveOccurrence(stream, ov as any, "2026-03-15"), false);
const inApp = (ov?: object) => {
  const d = resolveOccurrenceDetail(stream as any, ov as any);
  const amt = ov ? (ov as any).paycheck_amount : stream.paycheck_amount;
  return buildOccurrenceLedgerFields({ grossAmount: amt, retirement401k: 0, preTaxDeductions: 0, ...d } as any);
};

describe("aggregate-only historical override withholding", () => {
  it("keeps $500 aggregate and inherits no parent classifications", () => {
    expect(daily(aggOnly)).toMatchObject({ taxes_withheld: 500, federal_withholding: 0,
      state_withholding: 0, ss_withholding: 0, medicare_withholding: 0 });
  });
  it("unclassified total is not federal credit", () => {
    expect(daily(aggOnly).federal_withholding).toBe(0);
    expect(inApp(aggOnly).federal_withholding).toBe(0);
  });
  it("detailed override keeps its own classifications", () => {
    expect(daily(detailed)).toMatchObject({ federal_withholding: 450, state_withholding: 50,
      ss_withholding: 200, medicare_withholding: 50, taxes_withheld: 700 });
  });
  it("ordinary recurring conversion still uses stream splits", () => {
    expect(daily()).toMatchObject({ federal_withholding: 600, state_withholding: 200,
      ss_withholding: 300, medicare_withholding: 100, taxes_withheld: 1000 });
  });
  it("daily and in-app agree", () => {
    for (const ov of [aggOnly, detailed, undefined]) {
      const a = daily(ov), b = inApp(ov);
      for (const k of ["taxes_withheld", "federal_withholding", "state_withholding", "ss_withholding", "medicare_withholding", "deposited_amount"] as const)
        expect(b[k]).toBeCloseTo(a[k], 2);
    }
  });
  it("repeat conversion is deterministic", () => {
    expect(daily(aggOnly)).toEqual(daily(aggOnly));
  });
});
