import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const Y = 2026;

describe("Quarterly estimator — W-2 payroll tax exclusion + 1099 SE in target", () => {
  it("W-2 federal income tax withholding reduces payment-to-make", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      now: new Date(Y, 11, 31),
      personalEntries: [
        { income_date: `${Y}-05-15`, gross_amount: 30_000, federal_withholding: 4_000 },
      ],
    });
    expect(r.w2WithheldThisQuarter).toBe(4_000);
    expect(r.recommendedPaymentToMake).toBe(6_000);
  });

  it("W-2 Social Security & Medicare do NOT reduce payment-to-make", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      now: new Date(Y, 11, 31),
      personalEntries: [
        {
          income_date: `${Y}-05-15`,
          gross_amount: 30_000,
          federal_withholding: 0,
          ss_withholding: 1_860,
          medicare_withholding: 435,
          taxes_withheld: 2_295,
        },
      ],
    });
    expect(r.w2WithheldThisQuarter).toBe(0);
    expect(r.paidFromWithholding).toBe(0);
    expect(r.recommendedPaymentToMake).toBe(10_000);
  });

  it("Saved/reserved cash does NOT reduce payment-to-make", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-15`, gross_amount: 30_000, additional_tax_reserve: 5_000 },
      ],
    });
    expect(r.savedThisQuarter).toBe(5_000);
    expect(r.recommendedPaymentToMake).toBe(10_000);
  });

  it("Estimated tax payments reduce payment-to-make", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      payments: [{ applied_quarter: "Q2", applied_tax_year: Y, amount: 3_000 }],
    });
    expect(r.estimatedPaymentsMade).toBe(3_000);
    expect(r.recommendedPaymentToMake).toBe(7_000);
  });

  it("1099 self-employment tax is included in the quarterly target (via annual liability)", () => {
    // SE tax inclusion is the caller's responsibility (taxEngine includes SE
    // in annualTaxLiability). Validate the target reflects 1/4 of that.
    const annualWithSE = 60_000; // includes ~$14k SE tax
    const r = buildQuarterRecommendation({
      annualTaxLiability: annualWithSE,
      year: Y,
      quarter: 2,
    });
    expect(r.quarterTarget).toBe(15_000);
    expect(r.recommendedPaymentToMake).toBe(15_000);
  });
});
