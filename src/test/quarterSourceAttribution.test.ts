/**
 * Production QA regression: Quarterly Tax Progress SOURCE ATTRIBUTION.
 *
 * Premium account evidence:
 *   Baseline (W-2 only): target $1,505 / Paid $900 / Saved $979, one W-2 row.
 *   After $10,000 manual 1099 + $2,305 confirmed reserve: headline Saved
 *   correctly rose to $3,284, but the breakdown showed NO 1099 row and the W-2
 *   row carried all $3,284 — the 1099 reserve inherited the W-2 employer's
 *   source bucket.
 *
 * Source attribution must come from each reserve-bearing entry's own canonical
 * source identity, and a W-2 employer can never collapse into a business row.
 */
import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const NOW = new Date(2026, 7, 15); // Aug 15 2026 → Q3
const YEAR = 2026;
const Q = 3 as const;

/** 3 W-2 paychecks: $900 federal withheld, $979 reserved. */
const w2Entries = [
  { id: "w2-1", company: "QA Reserve W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-10", gross_amount: 9000, federal_withholding: 300, additional_tax_reserve: 300 },
  { id: "w2-2", company: "QA Reserve W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-11", gross_amount: 9000, federal_withholding: 300, additional_tax_reserve: 339 },
  { id: "w2-3", company: "QA Reserve W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-12", gross_amount: 9000, federal_withholding: 300, additional_tax_reserve: 340 },
];

const biz = (over: Record<string, unknown> = {}) => ({
  id: "e1099",
  company: "QA Reserve 1099",
  source_id: "biz-1",
  source_bucket: "personal",
  income_type: "1099",
  income_date: "2026-08-15",
  gross_amount: 10000,
  federal_withholding: 0,
  additional_tax_reserve: 0,
  linked_transaction_id: null as string | null,
  ...over,
});

const bankTx = (id: string, actual_withholding: number, source_id: string) => ({
  id,
  transaction_type: "income",
  transaction_date: "2026-08-15",
  amount: 10000,
  vendor: "QA deposit",
  source_id,
  status: "active",
  actual_withholding,
});

const base = (over: Record<string, unknown> = {}) => ({
  annualTaxLiability: 1505 * 4,
  year: YEAR,
  quarter: Q,
  quarterMethod: "even" as const,
  now: NOW,
  personalEntries: w2Entries,
  incomeEntries: [...w2Entries],
  transactions: [],
  ...over,
});

const w2Row = (r: ReturnType<typeof buildQuarterRecommendation>) =>
  r.sourceRows.find((x) => x.key === "w2:source:emp-1");
const bizRow = (
  r: ReturnType<typeof buildQuarterRecommendation>,
  id = "biz-1",
) => r.sourceRows.find((x) => x.key === `biz:source:${id}`);

describe("quarterly source attribution", () => {
  it("baseline: single W-2 row with Paid $900 / Saved $979", () => {
    const r = buildQuarterRecommendation(base());
    expect(Math.round(r.quarterTarget)).toBe(1505);
    expect(r.paidThisQuarter).toBeCloseTo(900, 2);
    expect(r.savedThisQuarter).toBeCloseTo(979, 2);
    expect(r.sourceRows).toHaveLength(1);
    expect(w2Row(r)!.saved).toBeCloseTo(979, 2);
  });

  it("reproduces the Premium case: two rows, no cross-source contamination", () => {
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 2648 * 4,
        incomeEntries: [...w2Entries, biz({ additional_tax_reserve: 2305 })],
      }),
    );
    expect(Math.round(r.quarterTarget)).toBe(2648);
    expect(r.savedThisQuarter).toBeCloseTo(3284, 2);
    expect(r.sourceRows).toHaveLength(2);
    expect(w2Row(r)!.saved).toBeCloseTo(979, 2);
    expect(w2Row(r)!.paid).toBeCloseTo(900, 2);
    expect(bizRow(r)!.label).toBe("QA Reserve 1099");
    expect(bizRow(r)!.saved).toBeCloseTo(2305, 2);
    expect(bizRow(r)!.paid).toBeCloseTo(0, 2);
    // No generic fallback bucket.
    expect(r.sourceRows.some((x) => x.key.endsWith("name:business income"))).toBe(false);
  });

  it("headline Saved always equals the sum of source Saved (and Paid)", () => {
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 2648 * 4,
        incomeEntries: [...w2Entries, biz({ additional_tax_reserve: 2305 })],
      }),
    );
    const sumSaved = r.sourceRows.reduce((s, x) => s + x.saved, 0);
    const sumPaid = r.sourceRows.reduce((s, x) => s + x.paid, 0);
    expect(sumSaved).toBeCloseTo(r.savedThisQuarter, 2);
    expect(sumPaid).toBeCloseTo(r.paidThisQuarter, 2);
  });

  it("a 1099 sharing the W-2 employer's source_id still gets its own row", () => {
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 2648 * 4,
        incomeEntries: [
          ...w2Entries,
          biz({ source_id: "emp-1", additional_tax_reserve: 2305 }),
        ],
      }),
    );
    expect(w2Row(r)!.saved).toBeCloseTo(979, 2);
    expect(bizRow(r, "emp-1")!.saved).toBeCloseTo(2305, 2);
    expect(r.sourceRows).toHaveLength(2);
  });

  it("multiple W-2 paychecks still dedupe into ONE employer row", () => {
    const r = buildQuarterRecommendation(
      base({ incomeEntries: [...w2Entries, ...w2Entries] }),
    );
    expect(r.sourceRows).toHaveLength(1);
    expect(r.savedThisQuarter).toBeCloseTo(979, 2);
    expect(w2Row(r)!.paid).toBeCloseTo(900, 2);
  });

  it("multiple 1099 rows for the same business aggregate together", () => {
    const r = buildQuarterRecommendation(
      base({
        incomeEntries: [
          ...w2Entries,
          biz({ id: "a", additional_tax_reserve: 1000 }),
          biz({ id: "b", additional_tax_reserve: 1305 }),
        ],
      }),
    );
    expect(bizRow(r)!.saved).toBeCloseTo(2305, 2);
    expect(r.sourceRows).toHaveLength(2);
  });

  it("different 1099 businesses remain separate rows", () => {
    const r = buildQuarterRecommendation(
      base({
        incomeEntries: [
          ...w2Entries,
          biz({ id: "a", source_id: "biz-1", company: "Biz One", additional_tax_reserve: 1000 }),
          biz({ id: "b", source_id: "biz-2", company: "Biz Two", additional_tax_reserve: 1305 }),
        ],
      }),
    );
    expect(bizRow(r, "biz-1")!.saved).toBeCloseTo(1000, 2);
    expect(bizRow(r, "biz-2")!.saved).toBeCloseTo(1305, 2);
    expect(r.sourceRows).toHaveLength(3);
  });

  it("manual 1099 with no linked transaction gets the correct source", () => {
    const r = buildQuarterRecommendation(
      base({
        incomeEntries: [...w2Entries, biz({ additional_tax_reserve: 2305, linked_transaction_id: null })],
        transactions: [],
      }),
    );
    expect(bizRow(r)!.saved).toBeCloseTo(2305, 2);
    expect(w2Row(r)!.saved).toBeCloseTo(979, 2);
  });

  it("linked 1099 transaction reserve counts once, under its own source", () => {
    const r = buildQuarterRecommendation(
      base({
        incomeEntries: [...w2Entries, biz({ linked_transaction_id: "tx-1" })],
        transactions: [bankTx("tx-1", 2305, "biz-1")],
      }),
    );
    expect(r.savedThisQuarter).toBeCloseTo(3284, 2);
    const rows = r.sourceRows.filter((x) => x.label.includes("1099"));
    expect(rows).toHaveLength(1);
    expect(rows[0].saved).toBeCloseTo(2305, 2);
    expect(w2Row(r)!.saved).toBeCloseTo(979, 2);
  });

  it("Saved → Paid behavior unchanged: estimated payments stay in Paid", () => {
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 2648 * 4,
        incomeEntries: [...w2Entries, biz({ additional_tax_reserve: 2305 })],
        payments: [{ id: "p1", payment_date: "2026-08-01", amount: 500, quarter: "Q3", tax_year: YEAR }],
      }),
    );
    expect(r.paidThisQuarter).toBeCloseTo(1400, 2);
    const sumPaid = r.sourceRows.reduce((s, x) => s + x.paid, 0);
    const sumSaved = r.sourceRows.reduce((s, x) => s + x.saved, 0);
    expect(sumPaid).toBeCloseTo(r.paidThisQuarter, 2);
    expect(sumSaved).toBeCloseTo(r.savedThisQuarter, 2);
    // W-2 withheld dollars never migrate into the 1099 row.
    expect(bizRow(r)!.paid).toBeCloseTo(0, 2);
  });
});

describe("estimate-increase status copy path", () => {
  const withRecommendations = (satisfied: boolean) =>
    w2Entries.map((e) => ({
      ...e,
      dynamic_tax_recommendation: e.additional_tax_reserve,
      additional_tax_reserve: satisfied ? e.additional_tax_reserve : 0,
    }));

  it("prior compliance + new 1099 income reads as estimate increased", () => {
    const rows = withRecommendations(true);
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 2648 * 4,
        personalEntries: rows,
        incomeEntries: [...rows, biz()],
        remainingOpportunities: 2,
      }),
    );
    expect(r.coverageStatus).toBe("estimate_increased");
    expect(r.statusHeadline).toContain("estimate increased");
    expect(r.statusDetail).not.toMatch(/short of/);
    // Baseline is exposed so recomputing surfaces keep the same classification.
    expect(r.baselineQuarterTarget).toBeGreaterThan(0);
  });

  it("genuine missed savings still reads as behind/catch-up", () => {
    const rows = withRecommendations(false);
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 2648 * 4,
        personalEntries: rows,
        incomeEntries: [...rows],
        remainingOpportunities: 2,
      }),
    );
    expect(r.coverageStatus).toBe("catch_up_needed");
    expect(r.statusHeadline).toBe("Additional catch-up needed");
  });
});
