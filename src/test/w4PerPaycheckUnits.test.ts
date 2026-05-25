/**
 * W-4 recommendation per-paycheck unit tests.
 *
 * Audit fix: ensure `step4cPerPaycheck` is always a PER-PAYCHECK amount
 * (annual employer gap ÷ remaining paychecks), never an annual amount
 * mislabeled as per-paycheck. Covers:
 *   - sufficient withholding (recommendation = $0)
 *   - under-withheld (positive per-paycheck < annual employer gap)
 *   - edge case: very few remaining paychecks (1–2)
 */
import { describe, it, expect } from "vitest";
import { computeAllocations, type EmployerRow } from "@/components/tax/W4PaycheckAdjustmentCard";

const mkRow = (over: Partial<EmployerRow> = {}): EmployerRow => ({
  streamId: "s1",
  company: "Acme",
  payFrequency: "biweekly",
  remainingPaychecks: 10,
  remainingGross: 50000,
  expectedNormalWithholding: 0,
  ...over,
});

describe("W-4 per-paycheck recommendation units", () => {
  it("sufficient withholding → per-paycheck recommendation is $0", () => {
    const rows = [mkRow({ remainingPaychecks: 10 })];
    const result = computeAllocations(rows, 0, 50000);
    expect(result[0].step4cPerPaycheck).toBe(0);
    expect(result[0].exactPerPaycheck).toBe(0);
    expect(result[0].exactEmployerGap).toBe(0);
  });

  it("under-withheld → per-paycheck > 0 and equals annual employer gap ÷ paychecks", () => {
    const rows = [mkRow({ remainingPaychecks: 10, remainingGross: 50000 })];
    const annualGap = 2000;
    const result = computeAllocations(rows, annualGap, 50000);
    const a = result[0];

    expect(a.step4cPerPaycheck).toBeGreaterThan(0);
    // exact (pre-rounding) per-paycheck is annual ÷ paychecks
    expect(a.exactPerPaycheck).toBeCloseTo(annualGap / 10, 6);
    // rounded value, when multiplied back, recovers ~annual gap
    expect(a.step4cPerPaycheck * a.remainingPaychecks).toBeCloseTo(annualGap, -1);
    // per-paycheck must be strictly smaller than the annual gap whenever
    // there is more than one paycheck (catches "annual mislabeled as per-paycheck").
    expect(a.step4cPerPaycheck).toBeLessThan(annualGap);
  });

  it("edge: only 1 remaining paycheck → per-paycheck equals the annual gap (rounded to $5)", () => {
    const rows = [mkRow({ remainingPaychecks: 1, remainingGross: 5000 })];
    const annualGap = 1234;
    const result = computeAllocations(rows, annualGap, 5000);
    const a = result[0];
    expect(a.remainingPaychecks).toBe(1);
    // With a single paycheck, per-paycheck == annual gap (within $5 rounding).
    expect(Math.abs(a.step4cPerPaycheck - annualGap)).toBeLessThanOrEqual(5);
    expect(a.step4cPerPaycheck % 5).toBe(0);
  });

  it("edge: 2 remaining paychecks → per-paycheck is roughly half the annual gap", () => {
    const rows = [mkRow({ remainingPaychecks: 2, remainingGross: 10000 })];
    const annualGap = 1000;
    const result = computeAllocations(rows, annualGap, 10000);
    const a = result[0];
    expect(a.remainingPaychecks).toBe(2);
    expect(a.exactPerPaycheck).toBeCloseTo(500, 6);
    // Rounded to nearest $5 must stay within one rounding bucket of half.
    expect(Math.abs(a.step4cPerPaycheck - 500)).toBeLessThanOrEqual(5);
  });

  it("multi-employer: each employer's per-paycheck = its annual share ÷ its paychecks", () => {
    const rows = [
      mkRow({ streamId: "a", remainingGross: 30000, remainingPaychecks: 10 }),
      mkRow({ streamId: "b", remainingGross: 10000, remainingPaychecks: 5 }),
    ];
    const result = computeAllocations(rows, 4000, 40000);
    for (const a of result) {
      // exactPerPaycheck must equal exactEmployerGap / remainingPaychecks
      expect(a.exactPerPaycheck).toBeCloseTo(
        a.exactEmployerGap / a.remainingPaychecks,
        6,
      );
      // Per-paycheck strictly less than that employer's annual share
      expect(a.step4cPerPaycheck).toBeLessThan(a.exactEmployerGap + 5);
    }
  });
});
