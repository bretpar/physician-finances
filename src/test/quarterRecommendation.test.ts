import { describe, it, expect } from "vitest";
import {
  computeQuarterRecommendation,
  shouldShowDashboardPaymentCallout,
  daysUntilDeadline,
} from "@/lib/quarterRecommendation";

const Y = 2026;

describe("computeQuarterRecommendation — paid/saved/recommended", () => {
  it("returns full quarter-target as recommended when nothing paid or saved", () => {
    const r = computeQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
    });
    expect(r.quarterTarget).toBe(10_000);
    expect(r.paidThisQuarter).toBe(0);
    expect(r.savedThisQuarter).toBe(0);
    expect(r.recommendedQuarterlyPayment).toBe(10_000);
  });

  it("W-2 federal withholding reduces recommended payment and counts as PAID", () => {
    const personalEntries = [
      { income_date: `${Y}-05-01`, gross_amount: 20_000, federal_withholding: 3_000 },
    ];
    const r = computeQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries,
    });
    expect(r.w2WithheldThisQuarter).toBe(3_000);
    expect(r.paidThisQuarter).toBe(3_000);
    expect(r.savedThisQuarter).toBe(0);
    expect(r.recommendedQuarterlyPayment).toBe(7_000);
  });

  it("logged estimated tax payment for the quarter reduces recommended payment", () => {
    const payments = [
      { applied_quarter: "Q2", applied_tax_year: Y, payment_date: `${Y}-06-10`, amount: 4_000 },
    ];
    const r = computeQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      payments,
    });
    expect(r.estimatedPaymentsThisQuarter).toBe(4_000);
    expect(r.paidThisQuarter).toBe(4_000);
    expect(r.recommendedQuarterlyPayment).toBe(6_000);
  });

  it("saved reserves reduce recommended payment but are NOT labeled as paid", () => {
    const personalEntries = [
      { income_date: `${Y}-05-01`, gross_amount: 20_000, additional_tax_reserve: 2_500 },
    ];
    const r = computeQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries,
    });
    expect(r.paidThisQuarter).toBe(0);
    expect(r.savedThisQuarter).toBe(2_500);
    expect(r.recommendedQuarterlyPayment).toBe(7_500);
  });

  it("does NOT double-count when a saved reserve is later logged as an estimated payment", () => {
    const personalEntries = [
      { income_date: `${Y}-05-01`, gross_amount: 20_000, additional_tax_reserve: 3_000 },
    ];
    const payments = [
      { applied_quarter: "Q2", applied_tax_year: Y, payment_date: `${Y}-06-10`, amount: 3_000 },
    ];
    const r = computeQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries,
      payments,
    });
    expect(r.paidThisQuarter).toBe(3_000);
    expect(r.savedThisQuarter).toBe(0); // raw saved (3k) - payments (3k) = 0
    expect(r.recommendedQuarterlyPayment).toBe(7_000);
  });

  it("dynamic mode uses quarter NET business profit (income minus expenses)", () => {
    const transactions = [
      // Q2 income $30k, Q2 deductible expenses $10k → Q2 net $20k
      { transaction_type: "income", transaction_date: `${Y}-05-15`, amount: 30_000 },
      { transaction_type: "expense", transaction_date: `${Y}-05-20`, amount: 10_000 },
      // Q3 income $20k, no expenses → Q3 net $20k
      { transaction_type: "income", transaction_date: `${Y}-08-01`, amount: 20_000 },
    ];
    const r = computeQuarterRecommendation({
      annualTaxLiability: 8_000,
      year: Y,
      quarter: 2,
      quarterMethod: "dynamic",
      transactions,
    });
    // Year net = 40k, Q2 net = 20k → share = 0.5 → target = 4,000
    expect(Math.round(r.quarterTarget)).toBe(4_000);
  });
});

describe("shouldShowDashboardPaymentCallout", () => {
  const baseRec = {
    deadline: new Date(2026, 5, 15), // Jun 15, 2026
    recommendedQuarterlyPayment: 5_000,
    coveragePct: 0,
  };

  it("shows callout 20 days before deadline", () => {
    const now = new Date(2026, 4, 28); // ~18 days before
    const r = shouldShowDashboardPaymentCallout(baseRec, now);
    expect(r.show).toBe(true);
    expect(r.overdue).toBe(false);
  });

  it("does NOT show callout 30 days before deadline", () => {
    const now = new Date(2026, 4, 15); // ~31 days before
    expect(shouldShowDashboardPaymentCallout(baseRec, now).show).toBe(false);
  });

  it("shows overdue version up to 7 days past deadline", () => {
    const now = new Date(2026, 5, 20); // 5 days past
    const r = shouldShowDashboardPaymentCallout(baseRec, now);
    expect(r.show).toBe(true);
    expect(r.overdue).toBe(true);
  });

  it("hides callout 8+ days past deadline", () => {
    const now = new Date(2026, 5, 24);
    expect(shouldShowDashboardPaymentCallout(baseRec, now).show).toBe(false);
  });

  it("hides callout when recommended payment is <= $100", () => {
    const now = new Date(2026, 5, 10);
    const r = shouldShowDashboardPaymentCallout(
      { ...baseRec, recommendedQuarterlyPayment: 50 },
      now,
    );
    expect(r.show).toBe(false);
  });

  it("hides callout when coverage >= 95%", () => {
    const now = new Date(2026, 5, 10);
    const r = shouldShowDashboardPaymentCallout(
      { ...baseRec, coveragePct: 96 },
      now,
    );
    expect(r.show).toBe(false);
  });

  it("does NOT hide callout merely because the user logged a small partial payment", () => {
    const now = new Date(2026, 5, 10);
    // $100 paid out of $5,000 target → coverage 2%, remaining $4,900
    const r = shouldShowDashboardPaymentCallout(
      { ...baseRec, recommendedQuarterlyPayment: 4_900, coveragePct: 2 },
      now,
    );
    expect(r.show).toBe(true);
  });
});

describe("daysUntilDeadline", () => {
  it("returns positive for future deadlines", () => {
    expect(daysUntilDeadline(new Date(2026, 5, 15), new Date(2026, 5, 10))).toBe(5);
  });
  it("returns negative for past deadlines", () => {
    expect(daysUntilDeadline(new Date(2026, 5, 15), new Date(2026, 5, 20))).toBe(-5);
  });
});
