import { describe, it, expect } from "vitest";
import {
  buildQuarterRecommendation,
  computeQuarterRecommendation,
  shouldShowDashboardPaymentCallout,
  daysUntilDeadline,
} from "@/lib/quarterRecommendation";
import { getCurrentQuarter } from "@/lib/quarters";

const Y = 2026;

describe("buildQuarterRecommendation — paid / saved / recommended", () => {
  it("returns full quarter-target as recommended when nothing paid or saved", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
    });
    expect(r.quarterLabel).toBe("Q2");
    expect(r.taxYear).toBe(Y);
    expect(r.deadlineLabel).toBe("Jun 15");
    expect(r.quarterTarget).toBe(10_000);
    expect(r.paidThisQuarter).toBe(0);
    expect(r.savedThisQuarter).toBe(0);
    expect(r.recommendedQuarterlyPayment).toBe(10_000);
  });

  it("W-2 federal withholding reduces recommended payment and counts as PAID, not saved", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 20_000, federal_withholding: 3_000 },
      ],
    });
    expect(r.paidFromWithholding).toBe(3_000);
    expect(r.paidThisQuarter).toBe(3_000);
    expect(r.savedThisQuarter).toBe(0);
    expect(r.recommendedQuarterlyPayment).toBe(7_000);
  });

  it("estimated payment for the quarter reduces recommended payment", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      payments: [
        { applied_quarter: "Q2", applied_tax_year: Y, payment_date: `${Y}-06-10`, amount: 4_000 },
      ],
    });
    expect(r.estimatedPaymentsMade).toBe(4_000);
    expect(r.paidThisQuarter).toBe(4_000);
    expect(r.recommendedQuarterlyPayment).toBe(6_000);
  });

  it("saved reserves reduce recommended payment but are NOT labeled as paid", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 20_000, additional_tax_reserve: 2_500 },
      ],
    });
    expect(r.paidThisQuarter).toBe(0);
    expect(r.savedThisQuarter).toBe(2_500);
    expect(r.savedFromIncome).toBe(2_500);
    expect(r.recommendedQuarterlyPayment).toBe(7_500);
  });

  it("does NOT double-count when a saved reserve becomes an estimated payment", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 20_000, additional_tax_reserve: 3_000 },
      ],
      payments: [
        { applied_quarter: "Q2", applied_tax_year: Y, payment_date: `${Y}-06-10`, amount: 3_000 },
      ],
    });
    expect(r.paidThisQuarter).toBe(3_000);
    expect(r.savedThisQuarter).toBe(0); // raw saved 3k - payments 3k = 0
    expect(r.recommendedQuarterlyPayment).toBe(7_000);
  });

  it("partial payment still shows the callout if more than $100 remains", () => {
    const rec = buildQuarterRecommendation({
      annualTaxLiability: 20_000,
      year: 2026,
      quarter: 2,
      payments: [
        { applied_quarter: "Q2", applied_tax_year: 2026, payment_date: "2026-06-01", amount: 100 },
      ],
      now: new Date(2026, 5, 10), // 5 days before Jun 15
    });
    expect(rec.recommendedQuarterlyPayment).toBe(4_900);
    expect(rec.showDashboardPaymentCallout).toBe(true);
    expect(rec.dashboardCalloutMode).toBe("due_soon");
  });

  it("includes manual tax_savings rows in savedFromIncome / saved", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      manualSavings: [{ savings_date: `${Y}-05-20`, amount: 1_500 }],
    });
    expect(r.manualTaxSavings).toBe(1_500);
    expect(r.savedFromIncome).toBe(1_500);
    expect(r.savedThisQuarter).toBe(1_500);
    expect(r.recommendedQuarterlyPayment).toBe(8_500);
  });

  it("dynamic mode uses quarter NET business profit (income minus expenses), not gross-only revenue", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 8_000,
      year: Y,
      quarter: 2,
      quarterMethod: "dynamic",
      transactions: [
        // Q2 income $30k, Q2 deductible expenses $10k → Q2 net $20k
        { transaction_type: "income", transaction_date: `${Y}-05-15`, amount: 30_000 },
        { transaction_type: "expense", transaction_date: `${Y}-05-20`, amount: 10_000 },
        // Q3 income $20k, no expenses → Q3 net $20k
        { transaction_type: "income", transaction_date: `${Y}-08-01`, amount: 20_000 },
      ],
    });
    // Year net = 40k, Q2 net = 20k → share = 0.5 → target = 4,000
    expect(Math.round(r.quarterTarget)).toBe(4_000);
  });

  it("computeQuarterRecommendation alias still works (back-compat)", () => {
    expect(computeQuarterRecommendation).toBe(buildQuarterRecommendation);
  });

  it("uses the same canonical quarter window as src/lib/quarters.ts", () => {
    const now = new Date(2026, 4, 1); // May 1 → Q2
    const canonical = getCurrentQuarter(now);
    const r = buildQuarterRecommendation({ annualTaxLiability: 40_000, now });
    expect(r.quarterLabel).toBe(canonical.label);
    expect(r.deadline.toDateString()).toBe(canonical.deadline.toDateString());
  });
});

describe("dashboard callout windows", () => {
  it("due-soon flag turns on 20 days before deadline", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      now: new Date(2026, 4, 28), // ~18 days before Jun 15
    });
    expect(r.isDueSoonWindow).toBe(true);
    expect(r.isOverdueWindow).toBe(false);
    expect(r.dashboardCalloutMode).toBe("due_soon");
  });

  it("due-soon flag is off 30 days before deadline", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      now: new Date(2026, 4, 15),
    });
    expect(r.isDueSoonWindow).toBe(false);
    expect(r.showDashboardPaymentCallout).toBe(false);
  });

  it("overdue window remains active up to 7 days past deadline", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      now: new Date(2026, 5, 20),
    });
    expect(r.isOverdueWindow).toBe(true);
    expect(r.dashboardCalloutMode).toBe("overdue");
  });

  it("overdue window ends 8+ days past deadline", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      now: new Date(2026, 5, 24),
    });
    expect(r.isOverdueWindow).toBe(false);
    expect(r.showDashboardPaymentCallout).toBe(false);
  });

  it("hides callout when recommended payment is <= $100", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 400,
      year: 2026,
      quarter: 2,
      now: new Date(2026, 5, 10),
    });
    // quarter target = 100, recommended = 100 → not meaningful
    expect(r.showDashboardPaymentCallout).toBe(false);
  });

  it("hides callout when coverage >= 95%", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      now: new Date(2026, 5, 10),
      payments: [
        { applied_quarter: "Q2", applied_tax_year: 2026, payment_date: "2026-06-01", amount: 9_700 },
      ],
    });
    // 9700 / 10000 = 97% coverage
    expect(r.coverageRatio).toBeGreaterThanOrEqual(0.95);
    expect(r.showDashboardPaymentCallout).toBe(false);
  });
});

describe("shouldShowDashboardPaymentCallout (legacy helper)", () => {
  it("still works using the recommendation object", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      now: new Date(2026, 4, 28),
    });
    const ret = shouldShowDashboardPaymentCallout(r, new Date(2026, 4, 28));
    expect(ret.show).toBe(true);
    expect(ret.overdue).toBe(false);
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
