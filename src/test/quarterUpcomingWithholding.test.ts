import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

/**
 * Future-dated W-2 paychecks in the current quarter must appear in the
 * source breakdown as `upcoming` (not Paid), so users can see why a
 * scheduled paycheck isn't yet counted toward Paid QTD.
 */
describe("Quarter source breakdown — upcoming withholding", () => {
  const YEAR = 2026;
  const BEFORE = new Date(YEAR, 5, 9); // Jun 9, 2026
  const AFTER = new Date(YEAR, 5, 13); // Jun 13, 2026

  const personalEntries = [
    { income_date: `${YEAR}-06-06`, gross_amount: 1_000, federal_withholding: 75, company: "Optum" },
    { income_date: `${YEAR}-06-08`, gross_amount: 2_000, federal_withholding: 200, company: "Veterans Affairs" },
    { income_date: `${YEAR}-06-12`, gross_amount: 5_000, federal_withholding: 607, company: "Virginia Mason" },
  ];

  it("Jun 9: Jun 12 Virginia Mason paycheck surfaces as upcoming, not paid", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      now: BEFORE,
      personalEntries,
    });
    expect(r.w2WithheldThisQuarter).toBe(275); // 75 + 200
    const vm = r.sourceRows.find((s) => s.label.startsWith("Virginia Mason"));
    expect(vm).toBeDefined();
    expect(vm!.paid).toBe(0);
    expect(vm!.upcoming).toBe(607);
    expect(vm!.upcomingDate).toBe(`${YEAR}-06-12`);
    // Paid sources have no upcoming
    const optum = r.sourceRows.find((s) => s.label.startsWith("Optum"));
    expect(optum!.upcoming).toBe(0);
  });

  it("Jun 13: Jun 12 Virginia Mason paycheck now counted as Paid, no longer upcoming", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      now: AFTER,
      personalEntries,
    });
    expect(r.w2WithheldThisQuarter).toBe(882); // 75 + 200 + 607
    const vm = r.sourceRows.find((s) => s.label.startsWith("Virginia Mason"));
    expect(vm!.paid).toBe(607);
    expect(vm!.upcoming).toBe(0);
  });

  it("Jun 12 paycheck belongs to Q3, not Q2", () => {
    const q2 = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 2,
      now: BEFORE,
      personalEntries,
    });
    const vmInQ2 = q2.sourceRows.find((s) => s.label.startsWith("Virginia Mason"));
    expect(vmInQ2).toBeUndefined();
    expect(q2.w2WithheldThisQuarter).toBe(0);
  });

  it("Future planned withholding does not reduce recommendedPaymentToMake", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: YEAR,
      quarter: 3,
      now: BEFORE,
      personalEntries,
    });
    // quarter target = 10_000 (even). paid = 275. So recommendedPaymentToMake = 9725.
    expect(r.recommendedPaymentToMake).toBe(10_000 - 275);
  });
});
