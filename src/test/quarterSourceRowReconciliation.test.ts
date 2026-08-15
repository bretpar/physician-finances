import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

/**
 * Regression: the expanded "This Quarter by Source" table must reconcile
 * exactly with the canonical headline totals, including after reserves are
 * converted into an estimated tax payment (the double-count guard).
 *
 *   sum(rows.paid)                === paidThisQuarter
 *   sum(rows.saved)               === savedThisQuarter
 *   sum(rows.paid + rows.saved)   === progressAmount
 */

const YEAR = 2026;
const NOW = new Date(YEAR, 7, 20); // Aug 20 — inside the Q3 window (Jun 1 – Aug 31)

const w2 = (over: Record<string, unknown> = {}) => ({
  income_date: `${YEAR}-07-15`,
  company: "QA W-2",
  gross_amount: 5000,
  federal_withholding: 433,
  ss_withholding: 310,
  medicare_withholding: 72.5,
  additional_tax_reserve: 77,
  ...over,
});

const bizTx = { id: "tx-1", transaction_type: "income", amount: 10000, transaction_date: `${YEAR}-07-10` };
const bizEntry = (over: Record<string, unknown> = {}) => ({
  income_date: `${YEAR}-07-10`,
  company: "Vituity QA",
  linked_transaction_id: "tx-1",
  federal_withholding: 0,
  additional_tax_reserve: 1000,
  ...over,
});

function build(payments: Array<{ applied_quarter: string; applied_tax_year: number; amount: number }> = []) {
  return buildQuarterRecommendation({
    annualTaxLiability: 3796, // /4 => 949 Q3 target
    year: YEAR,
    quarter: 3,
    quarterMethod: "even",
    personalEntries: [w2()],
    incomeEntries: [bizEntry()],
    transactions: [bizTx as any],
    payments,
    now: NOW,
  });
}

const sum = (rows: Array<{ paid: number; saved: number }>, key: "paid" | "saved") =>
  rows.reduce((s, r) => s + r[key], 0);

function expectReconciled(r: ReturnType<typeof buildQuarterRecommendation>) {
  expect(sum(r.sourceRows, "paid")).toBeCloseTo(r.paidThisQuarter, 6);
  expect(sum(r.sourceRows, "saved")).toBeCloseTo(r.savedThisQuarter, 6);
  expect(sum(r.sourceRows, "paid") + sum(r.sourceRows, "saved")).toBeCloseTo(r.progressAmount, 6);
}

describe("quarter source rows reconcile with headline totals", () => {
  it("reserve only (no estimated payment) leaves rows untouched", () => {
    const r = build();
    expect(r.paidThisQuarter).toBeCloseTo(433, 2);
    expect(r.savedThisQuarter).toBeCloseTo(1077, 2);
    expect(r.progressAmount).toBeCloseTo(1510, 2);
    expectReconciled(r);
  });

  it("partial estimated payment ($123) no longer double-counts", () => {
    const r = build([{ applied_quarter: "Q3", applied_tax_year: YEAR, amount: 123 }]);
    expect(r.paidThisQuarter).toBeCloseTo(556, 2);
    expect(r.savedThisQuarter).toBeCloseTo(954, 2);
    expect(r.progressAmount).toBeCloseTo(1510, 2);
    // Before the fix these summed to 556 paid / 1077 saved = 1633.
    expect(sum(r.sourceRows, "saved")).toBeCloseTo(954, 6);
    expectReconciled(r);
  });

  it("estimated payment equal to the saved amount zeroes out row savings", () => {
    const r = build([{ applied_quarter: "Q3", applied_tax_year: YEAR, amount: 1077 }]);
    expect(r.savedThisQuarter).toBeCloseTo(0, 6);
    expect(sum(r.sourceRows, "saved")).toBeCloseTo(0, 6);
    expectReconciled(r);
  });

  it("estimated payment larger than savings still reconciles", () => {
    const r = build([{ applied_quarter: "Q3", applied_tax_year: YEAR, amount: 5000 }]);
    expect(r.savedThisQuarter).toBe(0);
    expect(sum(r.sourceRows, "saved")).toBe(0);
    expectReconciled(r);
  });

  it("multiple saved sources are reduced pro-rata, never arbitrarily assigned", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 4000,
      year: YEAR,
      quarter: 3,
      quarterMethod: "even",
      personalEntries: [
        w2({ company: "Employer A", additional_tax_reserve: 300, federal_withholding: 100 }),
        w2({ company: "Employer B", additional_tax_reserve: 700, federal_withholding: 100 }),
      ],
      manualSavings: [{ savings_date: `${YEAR}-07-20`, amount: 1000 }],
      payments: [{ applied_quarter: "Q3", applied_tax_year: YEAR, amount: 500 }],
      now: NOW,
    });
    // Raw saved 2000, payment 500 => saved 1500 (75% of each source retained).
    expect(r.savedThisQuarter).toBeCloseTo(1500, 6);
    const byLabel = Object.fromEntries(r.sourceRows.map((x) => [x.label, x]));
    expect(byLabel["Employer A (W-2)"].saved).toBeCloseTo(225, 6);
    expect(byLabel["Employer B (W-2)"].saved).toBeCloseTo(525, 6);
    expect(byLabel["Manual tax savings"].saved).toBeCloseTo(750, 6);
    expectReconciled(r);
  });

  it("survives repeated payment / delete cycles", () => {
    for (const amount of [123, 0, 400, 0, 1077, 0, 50]) {
      const r = build(amount > 0 ? [{ applied_quarter: "Q3", applied_tax_year: YEAR, amount }] : []);
      expectReconciled(r);
    }
  });

  it("keeps Paid rows equal to headline Paid (payment row included once)", () => {
    const r = build([{ applied_quarter: "Q3", applied_tax_year: YEAR, amount: 123 }]);
    const paymentRow = r.sourceRows.find((x) => x.key === "__estimated_payments__");
    expect(paymentRow?.paid).toBeCloseTo(123, 6);
    expect(paymentRow?.saved).toBe(0);
    expect(sum(r.sourceRows, "paid")).toBeCloseTo(556, 6);
  });
});
