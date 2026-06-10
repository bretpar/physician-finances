import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

/**
 * Q3 Tax Progress: "Paid" must reflect actual W-2 withholding from real
 * paychecks dated in the quarter window AND on or before today. Future
 * paychecks, out-of-window paychecks, and full-quarter linear YTD spread
 * must never inflate Paid QTD.
 */
describe("Quarter Paid QTD — actual-through-today rule", () => {
  const YEAR = 2026;
  const TODAY = new Date(YEAR, 5, 9); // Jun 9, 2026

  it("Q3 on Jun 9 with no actual Q3 paycheck → W-2 paid is $0", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      now: TODAY,
      personalEntries: [
        // Past Q2 paycheck — not in Q3 window
        { income_date: `${YEAR}-05-15`, gross_amount: 10_000, federal_withholding: 2_500 },
        // Future Q3 paychecks — after today
        { income_date: `${YEAR}-06-20`, gross_amount: 10_000, federal_withholding: 2_500 },
        { income_date: `${YEAR}-07-15`, gross_amount: 10_000, federal_withholding: 2_500 },
        { income_date: `${YEAR}-08-31`, gross_amount: 10_000, federal_withholding: 2_500 },
      ],
    });
    expect(r.w2WithheldThisQuarter).toBe(0);
    expect(r.paidFromWithholding).toBe(0);
  });

  it("Q3 on Jun 9 with actual Jun 6 W-2 paycheck → includes that $500", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      now: TODAY,
      personalEntries: [
        { income_date: `${YEAR}-06-06`, gross_amount: 5_000, federal_withholding: 500, company: "Optum" },
        { income_date: `${YEAR}-07-15`, gross_amount: 10_000, federal_withholding: 2_500, company: "Optum" },
      ],
    });
    expect(r.w2WithheldThisQuarter).toBe(500);
    const optum = r.sourceRows.find((s) => s.key.includes("optum"));
    expect(optum?.paid).toBe(500);
  });

  it("future-dated paycheck never appears in source breakdown Paid", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      now: TODAY,
      personalEntries: [
        { income_date: `${YEAR}-07-15`, gross_amount: 10_000, federal_withholding: 1_620, company: "Virginia Mason" },
        { income_date: `${YEAR}-08-01`, gross_amount: 10_000, federal_withholding: 800, company: "Veterans Affairs" },
      ],
    });
    const vm = r.sourceRows.find((s) => s.key.includes("virginia mason"));
    const va = r.sourceRows.find((s) => s.key.includes("veterans affairs"));
    expect(vm?.paid ?? 0).toBe(0);
    expect(va?.paid ?? 0).toBe(0);
  });

  it("Jun 5 business reserve still maps to Q3 Saved", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      now: TODAY,
      transactions: [
        {
          id: "tx-jun5",
          transaction_type: "income",
          transaction_date: `${YEAR}-06-05`,
          amount: 10_000,
          actual_withholding: 2_500,
        },
      ],
      incomeEntries: [
        {
          linked_transaction_id: "tx-jun5",
          income_date: `${YEAR}-06-05`,
          company: "Consulting LLC",
          additional_tax_reserve: 0,
        },
      ],
    });
    expect(r.savedThisQuarter).toBe(2_500);
    expect(r.paidThisQuarter).toBe(0);
  });

  it("planned/projected future paychecks inflate target only, never Paid QTD", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      quarterMethod: "dynamic",
      now: TODAY,
      projectedPaychecks: [
        { date: `${YEAR}-07-15`, grossAmount: 10_000 },
        { date: `${YEAR}-08-15`, grossAmount: 10_000 },
      ],
      personalEntries: [],
    });
    expect(r.paidFromWithholding).toBe(0);
    expect(r.w2WithheldThisQuarter).toBe(0);
  });
});
