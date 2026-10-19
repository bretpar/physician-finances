import { describe, it, expect } from "vitest";
import { resolveOccurrence, ledgerFields } from "../../supabase/functions/planner-convert-daily/calc";
import { resolveOccurrenceDetail } from "@/hooks/useProjectedIncome";
import { buildOccurrenceLedgerFields } from "@/lib/plannerOccurrenceLedger";
import { getFederalIncomeTaxWithheld } from "@/lib/federalWithholding";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const stream = {
  id: "s1", paycheck_amount: 10000, taxes_withheld: 1200, federal_withholding: 600, state_withholding: 200,
  ss_withholding: 300, medicare_withholding: 100, retirement_401k: 0, employer_retirement_contribution: 0,
  pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0, additional_tax_reserve: 0,
};
const aggOnly = { action: "modify", new_date: null, paycheck_amount: 10000, retirement_401k: 0,
  employer_retirement_contribution: 0, pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0,
  additional_tax_reserve: 0, has_detailed_breakdown: false, taxes_withheld: 500,
  federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0 };
const conv = { origin_type: "planner_converted" };
const dailyRow = (ov?: object) => ({ ...conv, ...ledgerFields(resolveOccurrence(stream, ov as any, "2026-03-15"), false) });
const inAppRow = (ov?: object) => ({ ...conv, ...buildOccurrenceLedgerFields({
  grossAmount: 10000, retirement401k: 0, preTaxDeductions: 0, ...resolveOccurrenceDetail(stream as any, ov as any) } as any) });

describe("federal credit for aggregate-only planner conversions", () => {
  it("$500 unclassified → $0 credit, total kept, no parent inheritance (both paths)", () => {
    for (const r of [dailyRow(aggOnly), inAppRow(aggOnly)]) {
      expect(getFederalIncomeTaxWithheld(r)).toBe(0);
      expect(r.taxes_withheld).toBe(500);
      expect(r).toMatchObject({ federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0 });
    }
  });
  it("ordinary recurring conversion credits stream federal $600 on both paths", () => {
    expect(getFederalIncomeTaxWithheld(dailyRow())).toBe(600);
    expect(getFederalIncomeTaxWithheld(inAppRow())).toBe(600);
  });
  it("genuine federal-only and detailed W-2 withholding still count", () => {
    expect(getFederalIncomeTaxWithheld({ federal_withholding: 900, taxes_withheld: 900 })).toBe(900);
    expect(getFederalIncomeTaxWithheld({ ...conv, federal_withholding: 900, taxes_withheld: 900 })).toBe(900);
    expect(getFederalIncomeTaxWithheld({ federal_withholding: 450, ss_withholding: 200, medicare_withholding: 50, taxes_withheld: 700 })).toBe(450);
  });
  it("legacy manual aggregate-only rows keep the aggregate fallback", () => {
    expect(getFederalIncomeTaxWithheld({ taxes_withheld: 500, origin_type: "manual" })).toBe(500);
    expect(getFederalIncomeTaxWithheld({ taxes_withheld: 500 })).toBe(500);
  });
  it("collectors (reduce over rows, quarter Paid) add no credit for the unclassified row", () => {
    const rows = [dailyRow(aggOnly), dailyRow()];
    expect(rows.reduce((s, e) => s + getFederalIncomeTaxWithheld(e), 0)).toBe(600);
    const q = buildQuarterRecommendation({ annualTaxLiability: 40000, year: 2026, quarter: 1,
      now: new Date(2026, 2, 20, 12),
      personalEntries: [{ ...dailyRow(aggOnly), income_date: "2026-03-15", company: "Optum", id: "a" }] });
    expect(q.w2WithheldThisQuarter).toBe(0);
  });
});
