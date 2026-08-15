import { describe, it, expect } from "vitest";
import {
  getFederalIncomeTaxWithheld,
  getTotalFederalPaid,
  buildTotalFederalPayrollTaxes,
} from "@/lib/federalWithholding";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

/**
 * Regression: W-2 Social Security + Medicare are payroll taxes settled through
 * payroll. They must NEVER be credited against federal income-tax liability
 * (counted credits, remaining liability, projected shortage, quarterly Paid,
 * "Covered so far"). They stay available for informational payroll display via
 * `getTotalFederalPaid`.
 *
 * Codex production case: $105,000 gross W-2, $1,600 federal income tax,
 * $6,510 SS, $1,522.50 Medicare, $700 reserve, $14,270 estimated total tax.
 *   before: withholding and payments = $9,632.50, shortage = $4,637.50
 *   after:  withholding and payments = $1,600.00, shortage = $12,670.00
 */

const YEAR = 2026;
const CASE = {
  gross_amount: 105_000,
  federal_withholding: 1600,
  ss_withholding: 6510,
  medicare_withholding: 1522.5,
  taxes_withheld: buildTotalFederalPayrollTaxes({
    federal_withholding: 1600,
    ss_withholding: 6510,
    medicare_withholding: 1522.5,
  }),
  additional_tax_reserve: 700,
};
const ESTIMATED_TOTAL_TAX = 14_270;

describe("getFederalIncomeTaxWithheld", () => {
  it("returns federal income tax only when SS/Medicare splits exist", () => {
    expect(getFederalIncomeTaxWithheld(CASE)).toBe(1600);
    // The payroll-reporting helper keeps its existing meaning.
    expect(getTotalFederalPaid(CASE)).toBeCloseTo(9632.5, 2);
  });

  it("falls back to federal_withholding when no splits are present", () => {
    expect(getFederalIncomeTaxWithheld({ federal_withholding: 900 })).toBe(900);
  });

  it("falls back to a legacy total-only row", () => {
    expect(getFederalIncomeTaxWithheld({ taxes_withheld: 1200 })).toBe(1200);
  });

  it("never returns a negative or non-finite value", () => {
    expect(getFederalIncomeTaxWithheld(null)).toBe(0);
    expect(getFederalIncomeTaxWithheld({})).toBe(0);
    expect(getFederalIncomeTaxWithheld({ federal_withholding: -50 })).toBe(0);
  });
});

describe("W-2-only federal income-tax credit", () => {
  it("credits federal withholding only — not SS + Medicare", () => {
    const credit = getFederalIncomeTaxWithheld(CASE);
    expect(credit).toBe(1600);
    expect(credit).not.toBeCloseTo(9632.5, 2);
  });

  it("projected shortage uses the federal-only credit", () => {
    const shortage = ESTIMATED_TOTAL_TAX - getFederalIncomeTaxWithheld(CASE);
    expect(shortage).toBeCloseTo(12_670, 2);
    expect(shortage).not.toBeCloseTo(4637.5, 2);
  });

  it("the unsent reserve stays Saved and never becomes Paid", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: ESTIMATED_TOTAL_TAX,
      year: YEAR,
      quarter: 3,
      quarterMethod: "even",
      personalEntries: [{ ...CASE, income_date: `${YEAR}-07-15`, company: "QA W-2" }],
      now: new Date(YEAR, 7, 20),
    });
    expect(r.paidThisQuarter).toBe(1600);
    expect(r.savedThisQuarter).toBe(700);
    expect(r.progressAmount).toBe(2300);
    // SS + Medicare never appear anywhere in paid or saved.
    expect(r.paidThisQuarter + r.savedThisQuarter).toBeLessThan(9632.5);
  });

  it("W-2 + estimated payment: Paid = federal withholding + submitted payment", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: ESTIMATED_TOTAL_TAX,
      year: YEAR,
      quarter: 3,
      quarterMethod: "even",
      personalEntries: [
        { ...CASE, additional_tax_reserve: 0, income_date: `${YEAR}-07-15`, company: "QA W-2" },
      ],
      payments: [{ applied_quarter: "Q3", applied_tax_year: YEAR, amount: 2000 }],
      now: new Date(YEAR, 7, 20),
    });
    expect(r.paidThisQuarter).toBe(3600);
    expect(r.savedThisQuarter).toBe(0);
  });

  it("mixed W-2 + 1099 keeps its existing Paid/Saved classification", () => {
    const tx = { id: "tx-1", transaction_type: "income", amount: 10_000, transaction_date: `${YEAR}-07-10` };
    const r = buildQuarterRecommendation({
      annualTaxLiability: 3796,
      year: YEAR,
      quarter: 3,
      quarterMethod: "even",
      personalEntries: [
        {
          income_date: `${YEAR}-07-15`,
          company: "QA W-2",
          federal_withholding: 433,
          ss_withholding: 310,
          medicare_withholding: 72.5,
          additional_tax_reserve: 77,
        },
      ],
      incomeEntries: [
        {
          income_date: `${YEAR}-07-10`,
          company: "Vituity QA",
          linked_transaction_id: "tx-1",
          federal_withholding: 0,
          additional_tax_reserve: 1000,
        },
      ],
      transactions: [tx as any],
      now: new Date(YEAR, 7, 20),
    });
    expect(r.quarterTarget).toBeCloseTo(949, 2);
    expect(r.paidThisQuarter).toBeCloseTo(433, 2);
    expect(r.savedThisQuarter).toBeCloseTo(1077, 2);
    expect(r.progressAmount).toBeCloseTo(1510, 2);
  });
});
