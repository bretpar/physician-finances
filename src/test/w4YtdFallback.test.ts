import { describe, it, expect } from "vitest";
import {
  buildYtdFallbackEmployerRows,
  computeAllocations,
  defaultRemainingPaychecks,
  type EmployerRow,
} from "@/components/tax/W4PaycheckAdjustmentCard";

const YEAR = new Date().getFullYear();
const TODAY = new Date(YEAR, 5, 30); // mid-year for stable remaining-paycheck counts

// Build biweekly paydates starting Jan 13 up to (but not past) TODAY.
function biweeklyDatesYtd(): string[] {
  const out: string[] = [];
  const start = new Date(YEAR, 0, 13);
  for (let d = new Date(start); d <= TODAY; d.setDate(d.getDate() + 14)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Monthly: last calendar day of each month up to TODAY.
function monthlyDatesYtd(): string[] {
  const out: string[] = [];
  for (let m = 0; m <= TODAY.getMonth(); m++) {
    const last = new Date(YEAR, m + 1, 0);
    if (last <= TODAY) out.push(last.toISOString().slice(0, 10));
  }
  return out;
}

describe("buildYtdFallbackEmployerRows", () => {
  it("returns empty when there are no W-2 entries", () => {
    expect(buildYtdFallbackEmployerRows([], TODAY)).toEqual([]);
    expect(
      buildYtdFallbackEmployerRows(
        [
          {
            income_type: "1099_schedule_c",
            income_date: `${YEAR}-03-15`,
            company: "Solo PLLC",
            paycheck_amount: 5000,
            taxes_withheld: 0,
          },
        ],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("groups three W-2 employers and infers frequency from dates", () => {
    const bi = biweeklyDatesYtd();
    const mo = monthlyDatesYtd();
    const entries = [
      ...bi.map((d, i) => ({
        income_type: "w2",
        income_date: d,
        company: "Harborview Emergency Medicine",
        paycheck_amount: 120000 / bi.length,
        taxes_withheld: 22000 / bi.length,
        source_id: "src-harbor",
      })),
      ...mo.map((d, i) => ({
        income_type: "w2",
        income_date: d,
        company: "Valley Medical Center",
        paycheck_amount: 60000 / mo.length,
        taxes_withheld: 8000 / mo.length,
        source_id: "src-valley",
      })),
      ...mo.map((d, i) => ({
        income_type: "w2",
        income_date: d,
        company: "Northwest Ortho Moonlighting",
        paycheck_amount: 30000 / mo.length,
        taxes_withheld: 3000 / mo.length,
        source_id: "src-nw",
      })),
    ];

    const rows = buildYtdFallbackEmployerRows(entries, TODAY);
    expect(rows).toHaveLength(3);

    const byName = new Map(rows.map((r) => [r.company, r]));
    expect(byName.get("Harborview Emergency Medicine")?.payFrequency).toBe("biweekly");
    expect(byName.get("Valley Medical Center")?.payFrequency).toBe("monthly");
    expect(byName.get("Northwest Ortho Moonlighting")?.payFrequency).toBe("monthly");

    // Per-paycheck averages should be positive
    for (const r of rows) {
      expect(r.__ytdAvgGross).toBeGreaterThan(0);
      expect(r.__isYtdFallback).toBe(true);
    }
  });

  it("allocates the federal shortfall across employers using their own frequency", () => {
    const bi = biweeklyDatesYtd();
    const mo = monthlyDatesYtd();
    const rows = buildYtdFallbackEmployerRows(
      [
        ...bi.map((d) => ({
          income_type: "w2",
          income_date: d,
          company: "Harborview",
          paycheck_amount: 120000 / bi.length,
          taxes_withheld: 22000 / bi.length,
        })),
        ...mo.map((d) => ({
          income_type: "w2",
          income_date: d,
          company: "Valley",
          paycheck_amount: 60000 / mo.length,
          taxes_withheld: 8000 / mo.length,
        })),
        ...mo.map((d) => ({
          income_type: "w2",
          income_date: d,
          company: "Northwest",
          paycheck_amount: 30000 / mo.length,
          taxes_withheld: 3000 / mo.length,
        })),
      ],
      TODAY,
    );

    // Simulate the effectiveRows projection done inside the component:
    // remainingPaychecks * avgGross drives both gross and weighting.
    const effective: EmployerRow[] = rows.map((r) => {
      const remainingPaychecks = defaultRemainingPaychecks(r.payFrequency, TODAY);
      return {
        streamId: r.streamId,
        company: r.company,
        payFrequency: r.payFrequency,
        remainingPaychecks,
        remainingGross: r.__ytdAvgGross * remainingPaychecks,
        expectedNormalWithholding: r.__ytdAvgWithheld * remainingPaychecks,
      };
    });

    const FED_SHORTFALL = 3734; // federal income tax shortfall only — no FICA, no SE
    const totalGross = effective.reduce((s, r) => s + r.remainingGross, 0);
    const allocations = computeAllocations(effective, FED_SHORTFALL, totalGross);

    expect(allocations).toHaveLength(3);

    // Total recommended extra ≈ federal shortfall (within rounding to nearest $5/paycheck)
    const total = allocations.reduce(
      (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
      0,
    );
    expect(Math.abs(total - FED_SHORTFALL)).toBeLessThanOrEqual(5 * allocations.length);

    // Biweekly Harborview should get a different per-paycheck amount than the
    // monthly employers (different frequencies → different per-check math).
    const harbor = allocations.find((a) => a.company === "Harborview")!;
    const valley = allocations.find((a) => a.company === "Valley")!;
    expect(harbor.payFrequency).toBe("biweekly");
    expect(valley.payFrequency).toBe("monthly");
    // Largest employer (Harborview) carries the largest annual share
    const harborAnnual = harbor.step4cPerPaycheck * harbor.remainingPaychecks;
    const valleyAnnual = valley.step4cPerPaycheck * valley.remainingPaychecks;
    expect(harborAnnual).toBeGreaterThan(valleyAnnual);
  });

  it("recommends $0 extra when there is no federal shortfall", () => {
    const bi = biweeklyDatesYtd();
    const rows = buildYtdFallbackEmployerRows(
      bi.map((d) => ({
        income_type: "w2",
        income_date: d,
        company: "Harborview",
        paycheck_amount: 120000 / bi.length,
        taxes_withheld: 30000 / bi.length,
      })),
      TODAY,
    );

    const effective: EmployerRow[] = rows.map((r) => {
      const remainingPaychecks = defaultRemainingPaychecks(r.payFrequency, TODAY);
      return {
        streamId: r.streamId,
        company: r.company,
        payFrequency: r.payFrequency,
        remainingPaychecks,
        remainingGross: r.__ytdAvgGross * remainingPaychecks,
        expectedNormalWithholding: r.__ytdAvgWithheld * remainingPaychecks,
      };
    });

    const allocations = computeAllocations(
      effective,
      0, // no federal shortfall
      effective.reduce((s, r) => s + r.remainingGross, 0),
    );
    expect(allocations.every((a) => a.step4cPerPaycheck === 0)).toBe(true);
  });
});
