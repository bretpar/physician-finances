/**
 * Production QA regression: Premium savings-compliance for 1099 income.
 *
 * A manual 1099 income entry stored with `source_bucket = 'personal'` (which is
 * how some filing types are written) was skipped by the BUSINESS aggregation
 * loop's defensive bucket guard, while `usePersonalIncomeEntries()` filters
 * business income types OUT of the personal list. The row therefore reached
 * neither loop: its reserve (and the linked deposit's `actual_withholding`)
 * never entered `savedThisQuarter` and no 1099 source row appeared.
 */
import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";
import { deriveBaselineQuarterTarget } from "@/lib/catchUpRecommendation";

const NOW = new Date(2026, 7, 15); // Aug 15 2026 → Q3
const YEAR = 2026;
const Q = 3 as const;

/** 5 W-2 paychecks: $1,500 federal withheld, $4,468 reserved. */
const w2Entries = [
  { id: "w2-1", company: "QA Focused W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-14", gross_amount: 15000, federal_withholding: 300, additional_tax_reserve: 377 },
  { id: "w2-2", company: "QA Focused W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-14", gross_amount: 15000, federal_withholding: 300, additional_tax_reserve: 1023 },
  { id: "w2-3", company: "QA Focused W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-14", gross_amount: 15000, federal_withholding: 300, additional_tax_reserve: 1289 },
  { id: "w2-4", company: "QA Focused W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-14", gross_amount: 15000, federal_withholding: 300, additional_tax_reserve: 1779 },
  { id: "w2-5", company: "QA Focused W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-14", gross_amount: 15000, federal_withholding: 300, additional_tax_reserve: 0 },
];

/** Manual 1099 entry — note `source_bucket: 'personal'`, as production writes it. */
const make1099 = (over: Record<string, unknown> = {}) => ({
  id: "e1099",
  company: "QA Focused 1099",
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

const bankTx = (actual_withholding: number) => ({
  id: "tx-1099",
  transaction_type: "income",
  transaction_date: "2026-08-15",
  amount: 10000,
  vendor: "Focused catch-up 1099",
  source_id: "biz-1",
  status: "active",
  actual_withholding,
});

const base = (over: Record<string, unknown> = {}) => ({
  annualTaxLiability: 6164 * 4,
  year: YEAR,
  quarter: Q,
  quarterMethod: "even" as const,
  now: NOW,
  personalEntries: w2Entries,
  incomeEntries: [...w2Entries],
  transactions: [],
  ...over,
});

describe("1099 reserve reaches canonical savedThisQuarter", () => {
  it("baseline (W-2 only) reproduces Paid $1,500 / Saved $4,468", () => {
    const r = buildQuarterRecommendation(base());
    expect(Math.round(r.quarterTarget)).toBe(6164);
    expect(r.paidThisQuarter).toBeCloseTo(1500, 2);
    expect(r.savedThisQuarter).toBeCloseTo(4468, 2);
  });

  it("1. manual 1099 entry reserve counts in Saved", () => {
    const entry = make1099({ additional_tax_reserve: 2828 });
    const r = buildQuarterRecommendation(
      base({ incomeEntries: [...w2Entries, entry] }),
    );
    expect(r.savedThisQuarter).toBeCloseTo(7296, 2);
  });

  it("2. 1099 reserve without any linked transaction counts", () => {
    const entry = make1099({ additional_tax_reserve: 500, linked_transaction_id: null });
    const r = buildQuarterRecommendation(
      base({ incomeEntries: [...w2Entries, entry], transactions: [] }),
    );
    expect(r.savedThisQuarter).toBeCloseTo(4468 + 500, 2);
  });

  it("3. reserve held on the linked bank transaction counts exactly once", () => {
    const entry = make1099({ linked_transaction_id: "tx-1099" });
    const r = buildQuarterRecommendation(
      base({
        incomeEntries: [...w2Entries, entry],
        transactions: [bankTx(2828)],
      }),
    );
    expect(r.savedThisQuarter).toBeCloseTo(7296, 2);
    // Exactly one 1099 source row, no duplicate.
    const rows = r.sourceRows.filter((row) => row.label.includes("1099"));
    expect(rows).toHaveLength(1);
    expect(rows[0].saved).toBeCloseTo(2828, 2);
  });

  it("4. a 1099 source row appears keyed on the known business source", () => {
    const entry = make1099({ additional_tax_reserve: 2828 });
    const r = buildQuarterRecommendation(
      base({ incomeEntries: [...w2Entries, entry] }),
    );
    const row = r.sourceRows.find((x) => x.key === "biz:source:biz-1");
    expect(row).toBeTruthy();
    expect(row!.label).toBe("QA Focused 1099");
    // Never dumped into a generic fallback bucket.
    expect(r.sourceRows.some((x) => x.key === "biz:name:business income")).toBe(false);
    // W-2 employer row still separate and intact.
    const w2Row = r.sourceRows.find((x) => x.key === "w2:source:emp-1");
    expect(w2Row!.paid).toBeCloseTo(1500, 2);
    expect(w2Row!.saved).toBeCloseTo(4468, 2);
  });

  it("5. adding 1099 income raises the quarter target", () => {
    const before = buildQuarterRecommendation(base({ annualTaxLiability: 5011 * 4 }));
    const after = buildQuarterRecommendation(base({ annualTaxLiability: 6164 * 4 }));
    expect(Math.round(before.quarterTarget)).toBe(5011);
    expect(Math.round(after.quarterTarget)).toBe(6164);
    expect(after.quarterTarget).toBeGreaterThan(before.quarterTarget);
  });

  it("6 + 7. saving the catch-up reserve raises Saved and reduces remaining catch-up", () => {
    const beforeSave = buildQuarterRecommendation(
      base({ incomeEntries: [...w2Entries, make1099()] }),
    );
    const afterSave = buildQuarterRecommendation(
      base({ incomeEntries: [...w2Entries, make1099({ additional_tax_reserve: 2828 })] }),
    );
    expect(beforeSave.savedThisQuarter).toBeCloseTo(4468, 2);
    expect(afterSave.savedThisQuarter).toBeCloseTo(7296, 2);
    expect(afterSave.progressAmount).toBeGreaterThan(beforeSave.progressAmount);
    expect(afterSave.totalShortfallByDeadline).toBeLessThan(
      beforeSave.totalShortfallByDeadline,
    );
    expect(afterSave.totalShortfallByDeadline).toBe(0);
    expect(afterSave.catchUpPerOpportunity).toBe(0);
  });

  it("preserves W-2 Paid/Saved and SS/Medicare informational treatment", () => {
    const entry = make1099({ additional_tax_reserve: 2828, linked_transaction_id: "tx-1099" });
    const w2WithFica = w2Entries.map((e) => ({
      ...e,
      ss_withholding: 100,
      medicare_withholding: 25,
    }));
    const r = buildQuarterRecommendation(
      base({
        personalEntries: w2WithFica,
        incomeEntries: [...w2WithFica, entry],
        transactions: [bankTx(0)],
      }),
    );
    expect(r.w2WithheldThisQuarter).toBeCloseTo(1500, 2);
    expect(r.payrollTaxesHandledThisQuarter).toBeCloseTo(625, 2);
    expect(r.savedThisQuarter).toBeCloseTo(7296, 2);
    // Source-row invariants hold.
    const sumPaid = r.sourceRows.reduce((s, x) => s + x.paid, 0);
    const sumSaved = r.sourceRows.reduce((s, x) => s + x.saved, 0);
    expect(sumPaid).toBeCloseTo(r.paidThisQuarter, 2);
    expect(sumSaved).toBeCloseTo(r.savedThisQuarter, 2);
  });
});

describe("catch-up status language", () => {
  const withRecommendations = (satisfied: boolean) =>
    w2Entries.map((e) => ({
      ...e,
      dynamic_tax_recommendation: e.additional_tax_reserve > 0 ? e.additional_tax_reserve : 0,
      additional_tax_reserve: satisfied ? e.additional_tax_reserve : 0,
    }));

  it("8. estimate increased when every prior recommendation was followed", () => {
    const rows = withRecommendations(true);
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 9000 * 4,
        personalEntries: rows,
        incomeEntries: [...rows, make1099({ dynamic_tax_recommendation: 0 })],
        remainingOpportunities: 2,
      }),
    );
    expect(r.coverageStatus).toBe("estimate_increased");
    expect(r.statusHeadline).toContain("estimate increased");
    expect(r.statusDetail).not.toMatch(/short of/);
  });

  it("9. genuine missed savings still reads as behind", () => {
    const rows = withRecommendations(false);
    const r = buildQuarterRecommendation(
      base({
        annualTaxLiability: 9000 * 4,
        personalEntries: rows,
        incomeEntries: [...rows],
        remainingOpportunities: 2,
      }),
    );
    expect(r.coverageStatus).toBe("catch_up_needed");
    expect(r.statusHeadline).toBe("Additional catch-up needed");
  });

  it("deriveBaselineQuarterTarget only trusts fully satisfied plans", () => {
    expect(
      deriveBaselineQuarterTarget([{ recommended: 100, satisfied: 100 }], 500),
    ).toBe(500);
    expect(
      deriveBaselineQuarterTarget(
        [{ recommended: 100, satisfied: 100 }, { recommended: 100, satisfied: 10 }],
        500,
      ),
    ).toBe(0);
    expect(deriveBaselineQuarterTarget([], 500)).toBe(0);
  });
});
