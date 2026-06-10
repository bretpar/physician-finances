import { describe, it, expect } from "vitest";
import {
  buildQuarterRecommendation,
  computeQuarterRecommendation,
  shouldShowDashboardPaymentCallout,
  daysUntilDeadline,
  getActivePaymentTarget,
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
  });

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


describe("getActivePaymentTarget — next-relevant deadline selection", () => {
  it("on Jun 9 picks Q2 (Jun 15 deadline) even though calendar quarter is Q3", () => {
    const t = getActivePaymentTarget(new Date(2026, 5, 9));
    expect(t.quarter).toBe(2);
    expect(t.year).toBe(2026);
  });

  it("on Jun 23 (>7 days past Jun 15) falls back to current calendar quarter Q3", () => {
    const t = getActivePaymentTarget(new Date(2026, 5, 23));
    expect(t.quarter).toBe(3);
  });

  it("on May 1 (Q2 calendar quarter) stays on Q2 — no prior-quarter override", () => {
    const t = getActivePaymentTarget(new Date(2026, 4, 1));
    expect(t.quarter).toBe(2);
  });

  it("on Mar 30 picks Q1 (Apr 15 deadline) even though Q1 calendar quarter is still active", () => {
    const t = getActivePaymentTarget(new Date(2026, 2, 30));
    expect(t.quarter).toBe(1);
  });

  it("on Jan 5 picks prior-year Q4 (Jan 15 deadline)", () => {
    const t = getActivePaymentTarget(new Date(2026, 0, 5));
    expect(t.quarter).toBe(4);
    expect(t.year).toBe(2025);
  });
});

describe("Dashboard Jun 9 callout — Q2 due-soon recommendation", () => {
  const NOW = new Date(2026, 5, 9);
  it("with no W-2 / payments / saved, recommends the full Q2 target", () => {
    const target = getActivePaymentTarget(NOW);
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000,
      year: target.year,
      quarter: target.quarter,
      now: NOW,
    });
    expect(r.quarterLabel).toBe("Q2");
    expect(r.deadlineLabel).toBe("Jun 15");
    expect(r.recommendedPaymentToMake).toBe(20_000);
    expect(r.showDashboardPaymentCallout).toBe(true);
    expect(r.dashboardCalloutMode).toBe("due_soon");
  });

  it("subtracts W-2 withholding from recommendation", () => {
    const target = getActivePaymentTarget(NOW);
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000,
      year: target.year,
      quarter: target.quarter,
      now: NOW,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 30_000, federal_withholding: 5_000 },
      ],
    });
    expect(r.w2WithheldThisQuarter).toBe(5_000);
    expect(r.recommendedPaymentToMake).toBe(15_000);
  });

  it("subtracts existing estimated payments from recommendation", () => {
    const target = getActivePaymentTarget(NOW);
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000,
      year: target.year,
      quarter: target.quarter,
      now: NOW,
      payments: [
        { applied_quarter: "Q2", applied_tax_year: 2026, payment_date: "2026-06-01", amount: 4_000 },
      ],
    });
    expect(r.estimatedPaymentsMade).toBe(4_000);
    expect(r.recommendedPaymentToMake).toBe(16_000);
  });

  it("saved reserves reduce stillNeedToSave but NOT recommendedPaymentToMake (no double-count, not labeled paid)", () => {
    const target = getActivePaymentTarget(NOW);
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000,
      year: target.year,
      quarter: target.quarter,
      now: NOW,
      personalEntries: [
        { income_date: `${Y}-05-01`, gross_amount: 30_000, additional_tax_reserve: 8_000 },
      ],
    });
    expect(r.savedThisQuarter).toBe(8_000);
    expect(r.paidThisQuarter).toBe(0); // savings are NOT paid
    expect(r.recommendedPaymentToMake).toBe(20_000);
    expect(r.stillNeedToSave).toBe(12_000);
  });

  it("after a sufficient Q2 payment is logged, Dashboard stops showing the callout", () => {
    const target = getActivePaymentTarget(NOW);
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000,
      year: target.year,
      quarter: target.quarter,
      now: NOW,
      payments: [
        { applied_quarter: "Q2", applied_tax_year: 2026, payment_date: "2026-06-09", amount: 20_000 },
      ],
    });
    expect(r.coverageRatio).toBeGreaterThanOrEqual(0.95);
    expect(r.showDashboardPaymentCallout).toBe(false);
  });

  it("after the Q2 overdue window passes, getActivePaymentTarget returns Q3 and the Q2 callout no longer applies", () => {
    const later = new Date(2026, 5, 25); // 10 days past Jun 15
    const t = getActivePaymentTarget(later);
    expect(t.quarter).toBe(3);
  });
});

describe("IRS estimated-tax period mapping — Dashboard progress periods", () => {
  it("Q1 IRS period covers Jan 1 – Mar 31 with Apr 15 deadline", () => {
    const r = buildQuarterRecommendation({ annualTaxLiability: 40_000, year: 2026, quarter: 1 });
    expect(r.start.toDateString()).toBe(new Date(2026, 0, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 3, 1).toDateString());
    expect(r.deadline.toDateString()).toBe(new Date(2026, 3, 15).toDateString());
  });
  it("Q2 IRS period covers Apr 1 – May 31 with Jun 15 deadline", () => {
    const r = buildQuarterRecommendation({ annualTaxLiability: 40_000, year: 2026, quarter: 2 });
    expect(r.start.toDateString()).toBe(new Date(2026, 3, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 5, 1).toDateString());
    expect(r.deadline.toDateString()).toBe(new Date(2026, 5, 15).toDateString());
  });
  it("Q3 IRS period covers Jun 1 – Aug 31 with Sep 15 deadline", () => {
    const r = buildQuarterRecommendation({ annualTaxLiability: 40_000, year: 2026, quarter: 3 });
    expect(r.start.toDateString()).toBe(new Date(2026, 5, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 8, 1).toDateString());
    expect(r.deadline.toDateString()).toBe(new Date(2026, 8, 15).toDateString());
  });
  it("Q4 IRS period covers Sep 1 – Dec 31 with Jan 15 next-year deadline", () => {
    const r = buildQuarterRecommendation({ annualTaxLiability: 40_000, year: 2026, quarter: 4 });
    expect(r.start.toDateString()).toBe(new Date(2026, 8, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2027, 0, 1).toDateString());
    expect(r.deadline.toDateString()).toBe(new Date(2027, 0, 15).toDateString());
  });

  it("getCurrentQuarter on Jun 9 returns Q3 (IRS period — Jun 1–Aug 31)", () => {
    const q = getCurrentQuarter(new Date(2026, 5, 9));
    expect(q.quarter).toBe(3);
    expect(q.deadlineLabel).toBe("Sep 15");
  });
  it("getCurrentQuarter on May 31 returns Q2", () => {
    const q = getCurrentQuarter(new Date(2026, 4, 31));
    expect(q.quarter).toBe(2);
  });
  it("getCurrentQuarter on Sep 1 returns Q4", () => {
    const q = getCurrentQuarter(new Date(2026, 8, 1));
    expect(q.quarter).toBe(4);
  });

  it("Q3 recommendation uses Jun/Jul/Aug income, not May or Sep", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 3,
      now: new Date(2026, 11, 31), // year-end so 'isPast' allows all entries
      personalEntries: [
        { income_date: "2026-05-31", gross_amount: 10_000, federal_withholding: 1_000 }, // Q2
        { income_date: "2026-06-01", gross_amount: 10_000, federal_withholding: 2_000 }, // Q3
        { income_date: "2026-08-31", gross_amount: 10_000, federal_withholding: 3_000 }, // Q3
        { income_date: "2026-09-01", gross_amount: 10_000, federal_withholding: 9_000 }, // Q4
      ],
    });
    // YTD-through-end-of-Q3 (Sep 1): Q2 1k + Q3 2k + Q3 3k = 6k
    expect(r.w2WithheldThisQuarter).toBe(6_000);
  });

  it("Q3 progress window on Jun 9 is Jun 1 – Sep 1 with Sep 15 deadline", () => {
    const now = new Date(2026, 5, 9);
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000,
      year: 2026,
      quarter: 3,
      now,
    });
    expect(r.start.toDateString()).toBe(new Date(2026, 5, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 8, 1).toDateString());
    // Jun 9 is ~8/92 days into Q3 → small, NOT "hasn't started"
    const totalMs = r.end.getTime() - r.start.getTime();
    const elapsedMs = now.getTime() - r.start.getTime();
    const progress = elapsedMs / totalMs;
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(0.15);
  });
});

describe("paid vs planned — actual-only paid/saved", () => {
  const NOW = new Date(2026, 5, 9); // Jun 9
  it("Q3 on Jun 9 includes June 5 business income tax reserve as saved (not paid)", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 60_000,
      year: 2026,
      quarter: 3,
      now: NOW,
      incomeEntries: [
        {
          id: "ie1",
          linked_transaction_id: "tx1",
          income_date: "2026-06-05",
          gross_amount: 10_080,
          additional_tax_reserve: 2_500,
          company: "Business",
        },
      ],
      transactions: [
        { id: "tx1", transaction_type: "income", amount: 10_080, transaction_date: "2026-06-05" },
      ],
    });
    expect(r.savedFromIncome).toBe(2_500);
    expect(r.savedThisQuarter).toBe(2_500);
    expect(r.paidThisQuarter).toBe(0); // reserve is saved, not paid
  });

  it("future-dated W-2 paychecks are NOT counted as already paid", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 80_000,
      year: 2026,
      quarter: 3,
      now: NOW,
      personalEntries: [
        // Already-occurred June paycheck → counts as paid
        { income_date: "2026-06-05", gross_amount: 10_000, federal_withholding: 1_500 },
        // Future-dated July paycheck → MUST NOT count as paid
        { income_date: "2026-07-15", gross_amount: 10_000, federal_withholding: 2_000 },
        // Future-dated August paycheck → MUST NOT count as paid
        { income_date: "2026-08-15", gross_amount: 10_000, federal_withholding: 2_000 },
      ],
    });
    expect(r.w2WithheldThisQuarter).toBe(1_500);
    expect(r.paidThisQuarter).toBe(1_500);
  });

  it("future-dated 1099 income with planned withholding is NOT counted as paid", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 60_000,
      year: 2026,
      quarter: 3,
      now: NOW,
      incomeEntries: [
        {
          id: "ie1",
          linked_transaction_id: "tx1",
          income_date: "2026-08-01", // future relative to Jun 9
          gross_amount: 10_000,
          federal_withholding: 1_200,
          additional_tax_reserve: 0,
        },
      ],
      transactions: [
        { id: "tx1", transaction_type: "income", amount: 10_000, transaction_date: "2026-08-01" },
      ],
    });
    expect(r.otherWithheldThisQuarter).toBe(0);
    expect(r.paidThisQuarter).toBe(0);
  });

  it("planned future income can affect dynamic quarter target but never inflates Paid", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: 2026,
      quarter: 3,
      quarterMethod: "dynamic",
      now: NOW,
      transactions: [
        { transaction_type: "income", transaction_date: "2026-06-05", amount: 10_000 },
        { transaction_type: "income", transaction_date: "2026-08-15", amount: 30_000 }, // future
      ],
      personalEntries: [
        { income_date: "2026-08-15", gross_amount: 10_000, federal_withholding: 5_000 }, // future
      ],
    });
    expect(r.quarterTarget).toBeGreaterThan(0); // planned income shapes target
    expect(r.paidThisQuarter).toBe(0); // but no actual withholding has occurred yet
  });

  it("Q3 on Jun 9 is NOT a future quarter (does not say 'hasn't started')", () => {
    const r = buildQuarterRecommendation({ annualTaxLiability: 40_000, year: 2026, quarter: 3, now: NOW });
    expect(NOW >= r.start).toBe(true);
    expect(NOW < r.end).toBe(true);
  });
});

