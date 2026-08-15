/**
 * Regression: W-2 rows were double counted in Quarterly Tax Progress.
 *
 * `useIncomeEntries()` selects EVERY `income_entries` row while
 * `usePersonalIncomeEntries()` selects the personal (W-2) subset of the SAME
 * table. `buildQuarterRecommendation` received both lists and aggregated each
 * W-2 paycheck twice — inflating Paid, Saved, "Other federal withholding paid"
 * and producing two rows for one employer (production: $1,873 shown as $3,746).
 */
import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const now = new Date(2026, 7, 15); // Aug 15 2026 → calendar Q3 (Jun 1 – Aug 31)
const YEAR = 2026;
const QUARTER = 3 as const;

const w2 = (over: Record<string, any>) => ({
  id: over.id,
  source_bucket: "personal",
  company: "QA W2 Withholding 0814",
  source_id: "src-w2",
  income_type: "w2_employee",
  is_actual: true,
  gross_amount: 5000,
  federal_withholding: 0,
  state_withholding: 0,
  ss_withholding: 0,
  medicare_withholding: 0,
  additional_tax_reserve: 0,
  linked_transaction_id: null,
  ...over,
});

const base = {
  annualTaxLiability: 40000,
  year: YEAR,
  quarter: QUARTER,
  quarterMethod: "even" as const,
  now,
};

describe("quarterly W-2 aggregation is deduped by row id", () => {
  const premiumW2Rows = [
    w2({ id: "p1", income_date: "2026-06-06", additional_tax_reserve: 184 }),
    w2({ id: "p2", income_date: "2026-06-20", additional_tax_reserve: 250 }),
    w2({ id: "p3", income_date: "2026-07-04", additional_tax_reserve: 392 }),
    w2({ id: "p4", income_date: "2026-07-18", additional_tax_reserve: 487 }),
    w2({ id: "p5", income_date: "2026-08-01", additional_tax_reserve: 560 }),
  ];

  it("Premium QA case: 5 W-2 reserves total $1,873 once (not $3,746)", () => {
    const rec = buildQuarterRecommendation({
      ...base,
      // Same rows present in BOTH lists, exactly like production.
      incomeEntries: premiumW2Rows,
      personalEntries: premiumW2Rows,
    });
    expect(rec.savedThisQuarter).toBeCloseTo(1873, 2);
    expect(rec.rawSavedThisQuarter).toBeCloseTo(1873, 2);
    expect(rec.savedFromIncome).toBeCloseTo(1873, 2);
    // Exactly one employer row, and no business/"other" leakage.
    expect(rec.sourceRows).toHaveLength(1);
    expect(rec.sourceRows[0].saved).toBeCloseTo(1873, 2);
    expect(rec.otherWithheldThisQuarter).toBe(0);
  });

  it("Developer QA case: W-2 Paid $433 / Saved $77 counted once, business reserve once", () => {
    const w2Rows = [
      w2({
        id: "d1",
        income_date: "2026-07-10",
        federal_withholding: 433,
        additional_tax_reserve: 77,
      }),
    ];
    const businessRow = {
      id: "b1",
      source_bucket: "business",
      company: "QA Locums LLC",
      source_id: "src-biz",
      income_type: "1099_contractor",
      income_date: "2026-07-12",
      federal_withholding: 0,
      additional_tax_reserve: 150,
      linked_transaction_id: null,
    };

    const rec = buildQuarterRecommendation({
      ...base,
      incomeEntries: [...w2Rows, businessRow],
      personalEntries: w2Rows,
    });

    expect(rec.w2WithheldThisQuarter).toBeCloseTo(433, 2);
    // "Other federal withholding paid" must exclude already-attributed W-2 tax.
    expect(rec.otherWithheldThisQuarter).toBe(0);
    expect(rec.paidFromWithholding).toBeCloseTo(433, 2);
    expect(rec.savedThisQuarter).toBeCloseTo(77 + 150, 2);

    const labels = rec.sourceRows.map((r) => r.label);
    expect(labels).toHaveLength(2);
    expect(labels.filter((l) => l.includes("QA W2 Withholding 0814"))).toHaveLength(1);
    expect(labels.filter((l) => l.includes("QA Locums LLC"))).toHaveLength(1);
    const w2Row = rec.sourceRows.find((r) => r.label.includes("QA W2 Withholding 0814"))!;
    expect(w2Row.paid).toBeCloseTo(433, 2);
    expect(w2Row.saved).toBeCloseTo(77, 2);
  });

  it("same employer never appears as both 'Employer' and 'Employer (W-2)'", () => {
    const rows = [w2({ id: "x1", income_date: "2026-07-10", federal_withholding: 200 })];
    const rec = buildQuarterRecommendation({
      ...base,
      incomeEntries: rows,
      personalEntries: rows,
    });
    const keys = rec.sourceRows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rec.sourceRows).toHaveLength(1);
  });

  it("multiple paychecks from one employer aggregate into a single row", () => {
    const rows = [
      w2({ id: "m1", income_date: "2026-06-06", federal_withholding: 100, additional_tax_reserve: 10 }),
      w2({ id: "m2", income_date: "2026-06-20", federal_withholding: 120, additional_tax_reserve: 20 }),
      w2({ id: "m3", income_date: "2026-07-04", federal_withholding: 130, additional_tax_reserve: 30 }),
    ];
    const rec = buildQuarterRecommendation({ ...base, incomeEntries: rows, personalEntries: rows });
    expect(rec.sourceRows).toHaveLength(1);
    expect(rec.sourceRows[0].paid).toBeCloseTo(350, 2);
    expect(rec.sourceRows[0].saved).toBeCloseTo(60, 2);
    expect(rec.w2WithheldThisQuarter).toBeCloseTo(350, 2);
  });

  it("business/1099-only rows are unaffected by the dedupe guard", () => {
    const rec = buildQuarterRecommendation({
      ...base,
      incomeEntries: [
        {
          id: "b1",
          source_bucket: "business",
          company: "Solo Locums",
          source_id: "src-b",
          income_date: "2026-07-01",
          federal_withholding: 500,
          additional_tax_reserve: 250,
          linked_transaction_id: null,
        },
      ],
      personalEntries: [],
    });
    expect(rec.otherWithheldThisQuarter).toBeCloseTo(500, 2);
    expect(rec.savedThisQuarter).toBeCloseTo(250, 2);
    expect(rec.sourceRows).toHaveLength(1);
  });

  it("SS/Medicare stay informational and state follows the symmetric rule", () => {
    const rows = [
      w2({
        id: "s1",
        income_date: "2026-07-10",
        federal_withholding: 400,
        state_withholding: 90,
        ss_withholding: 310,
        medicare_withholding: 72.5,
      }),
    ];
    const noState = buildQuarterRecommendation({
      ...base,
      incomeEntries: rows,
      personalEntries: rows,
    });
    expect(noState.paidFromWithholding).toBeCloseTo(400, 2);
    expect(noState.payrollTaxesHandledThisQuarter).toBeCloseTo(382.5, 2);
    expect(noState.stateWithheldThisQuarter).toBeCloseTo(90, 2);

    const withState = buildQuarterRecommendation({
      ...base,
      incomeEntries: rows,
      personalEntries: rows,
      stateIncomeTaxIncludedInTarget: true,
    });
    expect(withState.paidFromWithholding).toBeCloseTo(490, 2);
    expect(withState.payrollTaxesHandledThisQuarter).toBeCloseTo(382.5, 2);
  });

  it("mixed W-2 + business totals stay consistent with the source rows", () => {
    const w2Rows = [
      w2({ id: "mix1", income_date: "2026-07-10", federal_withholding: 300, additional_tax_reserve: 100 }),
    ];
    const rec = buildQuarterRecommendation({
      ...base,
      incomeEntries: [
        ...w2Rows,
        {
          id: "mixb",
          source_bucket: "business",
          company: "Biz",
          source_id: "src-biz2",
          income_date: "2026-07-12",
          federal_withholding: 200,
          additional_tax_reserve: 50,
          linked_transaction_id: null,
        },
      ],
      personalEntries: w2Rows,
    });
    const sumPaid = rec.sourceRows.reduce((s, r) => s + r.paid, 0);
    const sumSaved = rec.sourceRows.reduce((s, r) => s + r.saved, 0);
    expect(sumPaid).toBeCloseTo(rec.paidThisQuarter, 6);
    expect(sumSaved).toBeCloseTo(rec.savedThisQuarter, 6);
    expect(rec.paidThisQuarter).toBeCloseTo(500, 2);
    expect(rec.savedThisQuarter).toBeCloseTo(150, 2);
  });

  it("Saved → Paid conversion keeps Covered unchanged (no double count)", () => {
    const rows = [w2({ id: "c1", income_date: "2026-07-10", additional_tax_reserve: 500 })];
    const before = buildQuarterRecommendation({ ...base, incomeEntries: rows, personalEntries: rows });
    const after = buildQuarterRecommendation({
      ...base,
      incomeEntries: rows,
      personalEntries: rows,
      payments: [{ applied_quarter: "Q3", applied_tax_year: YEAR, amount: 500 }],
    });
    expect(before.progressAmount).toBeCloseTo(500, 2);
    expect(after.progressAmount).toBeCloseTo(500, 2);
    expect(after.paidThisQuarter).toBeCloseTo(500, 2);
    expect(after.savedThisQuarter).toBeCloseTo(0, 2);
    expect(after.sourceRows.reduce((s, r) => s + r.saved, 0)).toBeCloseTo(0, 6);
  });
});
