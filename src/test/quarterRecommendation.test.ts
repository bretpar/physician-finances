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

describe("manual savings + payments vs other withholding separation", () => {
  it("estimatedPaymentsMade does NOT include other (1099/K-1) withholding", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      incomeEntries: [
        { income_date: "2026-05-01", linked_transaction_id: "t1", federal_withholding: 1_200, additional_tax_reserve: 0, company: "Co A" },
      ],
      transactions: [
        { id: "t1", transaction_type: "income", amount: 10_000, transaction_date: "2026-05-01" },
      ],
      payments: [
        { applied_quarter: "Q2", applied_tax_year: 2026, payment_date: "2026-06-01", amount: 500 },
      ],
    });
    expect(r.otherWithheldThisQuarter).toBe(1_200);
    expect(r.estimatedPaymentsMade).toBe(500);
    expect(r.estimatedPaymentsMade).not.toBe(1_700);
    expect(r.paidThisQuarter).toBe(1_700);
  });

  it("manual tax savings count toward savedThisQuarter and reduce recommended payment", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2,
      manualSavings: [
        { savings_date: "2026-05-15", amount: 2_500 },
      ],
    });
    expect(r.manualTaxSavings).toBe(2_500);
    expect(r.savedFromIncome).toBe(2_500);
    expect(r.savedThisQuarter).toBe(2_500);
    expect(r.recommendedQuarterlyPayment).toBe(7_500);
    expect(r.sourceRows.some((row) => row.key === "__manual_tax_savings__" && row.saved === 2_500)).toBe(true);
  });

  it("dashboard input with manualSavings matches tax-overview input with same data", () => {
    const base = {
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2 as const,
      incomeEntries: [],
      personalEntries: [
        { income_date: "2026-05-01", gross_amount: 20_000, federal_withholding: 1_000 },
      ],
      transactions: [],
      investmentEntries: [],
      manualSavings: [{ savings_date: "2026-05-10", amount: 1_500 }],
      payments: [],
    };
    const dash = buildQuarterRecommendation(base);
    const tax = buildQuarterRecommendation(base);
    expect(dash.recommendedQuarterlyPayment).toBe(tax.recommendedQuarterlyPayment);
    expect(dash.quarterTarget).toBe(tax.quarterTarget);
    expect(dash.savedThisQuarter).toBe(tax.savedThisQuarter);
  });
});

describe("dynamic quarter target uses net business profit (not gross-only)", () => {
  it("subtracts business expenses from quarter and year income shares", () => {
    const base = {
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 2 as const,
      quarterMethod: "dynamic" as const,
      transactions: [
        { id: "i1", transaction_type: "income", amount: 50_000, transaction_date: "2026-02-15" },
        { id: "i2", transaction_type: "income", amount: 50_000, transaction_date: "2026-05-15" },
        { id: "e1", transaction_type: "expense", amount: 40_000, transaction_date: "2026-05-20" },
      ],
    };
    const r = buildQuarterRecommendation(base);
    // Q2 net = 50k - 40k = 10k; year net = 100k - 40k = 60k → share 10/60
    const expected = 40_000 * (10_000 / 60_000);
    expect(r.quarterTarget).toBeCloseTo(expected, 1);
    // Gross-only share would be 50k/100k = 0.5 → 20_000. Confirm we are NOT that.
    expect(r.quarterTarget).toBeLessThan(20_000);
  });
});

describe("recommendedPaymentToMake — excludes saved reserves", () => {
  it("matches spec example: target 20k, W-2 5k, saved 10k → make 15k, still save 5k", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000, // even → 20k/quarter
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 30_000, federal_withholding: 5_000, additional_tax_reserve: 10_000 },
      ],
    });
    expect(r.quarterTarget).toBe(20_000);
    expect(r.paidThisQuarter).toBe(5_000);
    expect(r.savedThisQuarter).toBe(10_000);
    expect(r.recommendedPaymentToMake).toBe(15_000);
    expect(r.stillNeedToSave).toBe(5_000);
  });

  it("saved reserves do NOT reduce recommendedPaymentToMake", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 20_000, additional_tax_reserve: 4_000 },
      ],
    });
    expect(r.savedThisQuarter).toBe(4_000);
    expect(r.recommendedPaymentToMake).toBe(10_000); // full target — savings don't subtract
    expect(r.stillNeedToSave).toBe(6_000);
  });

  it("W-2 withholding reduces recommendedPaymentToMake", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 20_000, federal_withholding: 3_000 },
      ],
    });
    expect(r.recommendedPaymentToMake).toBe(7_000);
    expect(r.stillNeedToSave).toBe(7_000);
  });

  it("estimated payments made reduce recommendedPaymentToMake", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      payments: [
        { applied_quarter: "Q2", applied_tax_year: Y, payment_date: `${Y}-06-10`, amount: 4_000 },
      ],
    });
    expect(r.recommendedPaymentToMake).toBe(6_000);
  });

  it("saved reserves reduce stillNeedToSave only", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 20_000, additional_tax_reserve: 7_000 },
      ],
    });
    expect(r.recommendedPaymentToMake).toBe(10_000);
    expect(r.stillNeedToSave).toBe(3_000);

  it("W-2 withholding paid excludes Social Security and Medicare", () => {
    // Mixed W-2 + 1099 regression: Tax Overview must show only federal
    // income tax withholding ($22,000), not the total payroll tax
    // ($31,180 = 22,000 + 7,440 + 1,740).
    const r = buildQuarterRecommendation({
      annualTaxLiability: 50_000,
      year: Y,
      quarter: 3,
      personalEntries: [
        {
          income_date: `${Y}-05-31`,
          gross_amount: 120_000,
          federal_withholding: 22_000,
          ss_withholding: 7_440,
          medicare_withholding: 1_740,
          taxes_withheld: 31_180, // canonical total payroll
        },
      ],
      payments: [
        { applied_quarter: "Q3", applied_tax_year: Y, amount: 8_000 },
      ],
    });
    expect(r.w2WithheldThisQuarter).toBe(22_000);
    expect(r.w2WithheldThisQuarter).not.toBe(31_180);
    expect(r.estimatedPaymentsMade).toBe(8_000);
    expect(r.paidThisQuarter).toBe(30_000);
  });
});

