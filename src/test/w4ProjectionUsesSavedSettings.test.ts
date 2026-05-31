import { describe, it, expect } from "vitest";
import {
  buildYtdFallbackEmployerRows,
  computeAllocations,
  defaultRemainingPaychecks,
  type EmployerRow,
} from "@/components/tax/W4PaycheckAdjustmentCard";

const YEAR = new Date().getFullYear();
const TODAY = new Date(YEAR, 5, 30);

function biweeklyDatesYtd(): string[] {
  const out: string[] = [];
  const start = new Date(YEAR, 0, 13);
  for (let d = new Date(start); d <= TODAY; d.setDate(d.getDate() + 14)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Regression tests for the W-4 calculator's projection logic.
 *
 * Production bug: a W-2 user with YTD catch-up + a recent recurring paycheck
 * saw projected gross like $660,000 because the YTD catch-up lump sum was
 * being averaged as if it were a normal paycheck and multiplied across the
 * remaining year.
 */
describe("W-4 YTD catch-up rows must NOT be treated as recurring paychecks", () => {
  it("excludes ytd_catchup entries from per-paycheck averaging", () => {
    const bi = biweeklyDatesYtd();
    const recurringGross = 8000;
    const recurringWithheld = 1200;
    const entries = [
      // One large YTD catch-up lump for $80k gross / $11k withheld
      {
        income_type: "w2",
        income_date: `${YEAR}-01-05`,
        company: "Evergreen Medical Group",
        paycheck_amount: 80000,
        taxes_withheld: 11000,
        entry_kind: "ytd_catchup",
        origin_type: "ytd_catchup",
      },
      // Plus normal biweekly paychecks for the same employer
      ...bi.slice(1).map((d) => ({
        income_type: "w2",
        income_date: d,
        company: "Evergreen Medical Group",
        paycheck_amount: recurringGross,
        taxes_withheld: recurringWithheld,
      })),
    ];

    const rows = buildYtdFallbackEmployerRows(entries, TODAY);
    expect(rows).toHaveLength(1);
    const r = rows[0];

    // Averages must reflect ONLY recurring paychecks, not the lump.
    expect(r.__ytdAvgGross).toBeCloseTo(recurringGross, 0);
    expect(r.__ytdAvgWithheld).toBeCloseTo(recurringWithheld, 0);

    // YTD totals must still include the lump (used elsewhere as actual YTD).
    expect(r.__ytdGrossTotal).toBe(80000 + recurringGross * (bi.length - 1));
    expect(r.__ytdWithheldTotal).toBe(11000 + recurringWithheld * (bi.length - 1));

    // Projected remaining must NOT explode to hundreds of thousands.
    const remainingPaychecks = defaultRemainingPaychecks(r.payFrequency, TODAY);
    const projectedRemainingGross = r.__ytdAvgGross * remainingPaychecks;
    expect(projectedRemainingGross).toBeLessThan(remainingPaychecks * recurringGross + 1);
    expect(projectedRemainingGross).toBeLessThan(300_000);
  });

  it("returns zero per-paycheck average when only catch-up entries exist", () => {
    const rows = buildYtdFallbackEmployerRows(
      [
        {
          income_type: "w2",
          income_date: `${YEAR}-01-05`,
          company: "Solo W-2",
          paycheck_amount: 80000,
          taxes_withheld: 11000,
          entry_kind: "ytd_catchup",
        },
      ],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].__ytdAvgGross).toBe(0);
    expect(rows[0].__ytdAvgWithheld).toBe(0);
    // YTD totals still tracked
    expect(rows[0].__ytdGrossTotal).toBe(80000);
    expect(rows[0].__ytdWithheldTotal).toBe(11000);
  });

  it("recognizes linked_ytd_catchup_id and origin_type ytd_catchup", () => {
    const rows = buildYtdFallbackEmployerRows(
      [
        {
          income_type: "w2",
          income_date: `${YEAR}-01-05`,
          company: "Acme",
          paycheck_amount: 50000,
          taxes_withheld: 7000,
          linked_ytd_catchup_id: "abc-123",
        },
        {
          income_type: "w2",
          income_date: `${YEAR}-02-01`,
          company: "Acme",
          paycheck_amount: 4000,
          taxes_withheld: 600,
        },
      ],
      TODAY,
    );
    expect(rows[0].__ytdAvgGross).toBe(4000);
    expect(rows[0].__ytdAvgWithheld).toBe(600);
  });
});

describe("W-4 allocation reflects federal-only shortfall", () => {
  it("recommends nonzero extra withholding when projected fed tax > projected fed withholding", () => {
    const rows: EmployerRow[] = [
      {
        streamId: "emp:evergreen|w2",
        company: "Evergreen",
        payFrequency: "biweekly",
        remainingPaychecks: 13,
        remainingGross: 104000,
        expectedNormalWithholding: 14300,
      },
      {
        streamId: "emp:harbor|w2",
        company: "Harbor",
        payFrequency: "biweekly",
        remainingPaychecks: 13,
        remainingGross: 78000,
        expectedNormalWithholding: 5200,
      },
    ];
    const fedGap = 4000; // projected fed tax shortfall (NOT incl. FICA/SE)
    const totalGross = rows.reduce((s, r) => s + r.remainingGross, 0);
    const allocs = computeAllocations(rows, fedGap, totalGross);

    expect(allocs).toHaveLength(2);
    const total = allocs.reduce((s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks, 0);
    expect(total).toBeGreaterThan(0);
    // $5/paycheck rounding can shift by up to 5 * remainingPaychecks per employer.
    expect(Math.abs(total - fedGap)).toBeLessThanOrEqual(5 * 13 * allocs.length);
    // Largest employer carries the largest annual share
    const evergreen = allocs.find((a) => a.company === "Evergreen")!;
    const harbor = allocs.find((a) => a.company === "Harbor")!;
    expect(evergreen.step4cPerPaycheck).toBeGreaterThanOrEqual(harbor.step4cPerPaycheck);
  });

  it("recommends $0 when projected withholding fully covers projected fed tax", () => {
    const rows: EmployerRow[] = [
      {
        streamId: "emp:a|w2",
        company: "A",
        payFrequency: "biweekly",
        remainingPaychecks: 13,
        remainingGross: 100000,
        expectedNormalWithholding: 20000,
      },
    ];
    const allocs = computeAllocations(rows, 0, 100000);
    expect(allocs.every((a) => a.step4cPerPaycheck === 0)).toBe(true);
  });
});
