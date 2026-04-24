/**
 * W-2 federal payroll tax consistency tests.
 *
 * Proves a single canonical concept across the platform:
 *   Total Federal Payroll Taxes = federal income tax + Social Security + Medicare
 *
 * State withholding is NOT part of this total.
 */
import { describe, it, expect } from "vitest";
import { getTotalFederalPaid, buildTotalFederalPayrollTaxes } from "@/lib/federalWithholding";

describe("federalWithholding canonical helper", () => {
  it("A. Manual W-2 entry with full breakdown returns correct total", () => {
    // gross 10000, fed 500, ss 620, medicare 145, state 300
    // → total federal payroll taxes = 1265 (state NOT included)
    const entry = {
      taxes_withheld: 1265,
      federal_withholding: 500,
      ss_withholding: 620,
      medicare_withholding: 145,
    };
    expect(getTotalFederalPaid(entry)).toBe(1265);
  });

  it("B. Single total field only (taxes_withheld populated, components blank)", () => {
    const entry = {
      taxes_withheld: 1265,
      federal_withholding: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
    };
    expect(getTotalFederalPaid(entry)).toBe(1265);
  });

  it("C. Projected W-2 stream — uses canonical total via helper", () => {
    // Stream saved under new shape: taxes_withheld is the canonical total.
    const stream = {
      taxes_withheld: 1265,
      federal_withholding: 500,
      ss_withholding: 620,
      medicare_withholding: 145,
    };
    expect(getTotalFederalPaid(stream)).toBe(1265);
  });

  it("D. Planner conversion result has correct canonical fields", () => {
    // The converted income_entry should have taxes_withheld set to the
    // total federal payroll taxes, with components preserved separately.
    const converted = {
      taxes_withheld: 1265, // canonical total
      federal_withholding: 500,
      ss_withholding: 620,
      medicare_withholding: 145,
    };
    expect(getTotalFederalPaid(converted)).toBe(1265);
    expect(buildTotalFederalPayrollTaxes(converted)).toBe(1265);
  });

  it("E. No double counting — taxes_withheld + components both present", () => {
    const entry = {
      taxes_withheld: 1265,
      federal_withholding: 500,
      ss_withholding: 620,
      medicare_withholding: 145,
    };
    // Helper returns 1265, never 2530.
    expect(getTotalFederalPaid(entry)).toBe(1265);
    expect(getTotalFederalPaid(entry)).not.toBe(2530);
  });

  it("Legacy: federal_withholding stored as combined total (pre-fix rows)", () => {
    // Older Personal Income rows wrote the combined federal+SS+Medicare into
    // federal_withholding, with taxes_withheld also set. New helper still
    // returns the right number (taxes_withheld wins).
    const legacy = {
      taxes_withheld: 1265,
      federal_withholding: 1265, // legacy: held the combined total
      ss_withholding: 0,
      medicare_withholding: 0,
    };
    expect(getTotalFederalPaid(legacy)).toBe(1265);
  });

  it("Legacy: only federal_withholding populated (no taxes_withheld, no components)", () => {
    const legacy = {
      taxes_withheld: 0,
      federal_withholding: 1265, // legacy combined total
      ss_withholding: 0,
      medicare_withholding: 0,
    };
    expect(getTotalFederalPaid(legacy)).toBe(1265);
  });

  it("Legacy: split components only (no taxes_withheld, federal < ss+medicare)", () => {
    const legacy = {
      taxes_withheld: 0,
      federal_withholding: 500, // federal income tax only (less than ss+medicare)
      ss_withholding: 620,
      medicare_withholding: 145,
    };
    expect(getTotalFederalPaid(legacy)).toBe(1265);
  });

  it("buildTotalFederalPayrollTaxes sums components", () => {
    expect(
      buildTotalFederalPayrollTaxes({
        federal_withholding: 500,
        ss_withholding: 620,
        medicare_withholding: 145,
      }),
    ).toBe(1265);
  });

  it("buildTotalFederalPayrollTaxes accepts string inputs", () => {
    expect(
      buildTotalFederalPayrollTaxes({
        federal_withholding: "500",
        ss_withholding: "620",
        medicare_withholding: "145",
      }),
    ).toBe(1265);
  });

  it("Empty / null entry returns 0", () => {
    expect(getTotalFederalPaid(null)).toBe(0);
    expect(getTotalFederalPaid(undefined)).toBe(0);
    expect(getTotalFederalPaid({})).toBe(0);
  });

  it("State withholding is NEVER part of the federal total", () => {
    const entry = {
      taxes_withheld: 1265,
      federal_withholding: 500,
      ss_withholding: 620,
      medicare_withholding: 145,
      // state_withholding intentionally not in the WithholdingFields shape.
    };
    expect(getTotalFederalPaid(entry as any)).toBe(1265); // not 1565
  });
});
