import { describe, it, expect } from "vitest";
import {
  buildCompanyOnlyEmployerRows,
  computeAllocations,
  computeRemainingW4Gap,
  type EmployerRow,
} from "@/components/tax/W4PaycheckAdjustmentCard";

describe("buildCompanyOnlyEmployerRows", () => {
  it("creates one row per saved W-2 company when no streams/YTD exist", () => {
    const rows = buildCompanyOnlyEmployerRows(
      [
        { name: "Evergreen Medical Group", companyType: "w2", payFrequency: "biweekly" },
        { name: "Harbor Emergency Physicians", companyType: "w2", payFrequency: "biweekly" },
      ],
      new Set(),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].company).toBe("Evergreen Medical Group");
    expect(rows[0].employerKey).toBe("emp:evergreen medical group|w2");
    expect(rows[1].employerKey).toBe("emp:harbor emergency physicians|w2");
  });

  it("skips non-W-2 company types", () => {
    const rows = buildCompanyOnlyEmployerRows(
      [
        { name: "Side Gig LLC", companyType: "1099_schedule_c", payFrequency: null },
        { name: "Partner Co", companyType: "k1_partnership", payFrequency: null },
        { name: "MyClinic", companyType: "scorp_w2", payFrequency: "monthly" },
      ],
      new Set(),
    );
    expect(rows.map((r) => r.company)).toEqual(["MyClinic"]);
  });

  it("skips companies already represented by existing employer rows", () => {
    const existing = new Set(["emp:evergreen medical group|w2"]);
    const rows = buildCompanyOnlyEmployerRows(
      [
        { name: "Evergreen Medical Group", companyType: "w2", payFrequency: "biweekly" },
        { name: "Harbor Emergency Physicians", companyType: "w2", payFrequency: "biweekly" },
      ],
      existing,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("Harbor Emergency Physicians");
  });

  it("regression: two-$90k W-2 employers with no streams produce W-4 allocation", () => {
    // Fresh W-2-only Single WA scenario from the diagnostic. Both employers
    // have saved settings (projectedAnnualGross + expectedFederalWithholding)
    // but no active projected income streams. Building company-only rows is
    // what unblocks the W-4 tab from rendering nothing.
    const companyRows = buildCompanyOnlyEmployerRows(
      [
        { name: "Evergreen Medical Group", companyType: "w2", payFrequency: "biweekly" },
        { name: "Harbor Emergency Physicians", companyType: "w2", payFrequency: "biweekly" },
      ],
      new Set(),
    );
    expect(companyRows).toHaveLength(2);

    // Simulate what `effectiveRows` would produce after overlaying saved
    // company settings: each employer has $45k remaining gross and 13
    // remaining biweekly paychecks at $450 expected federal withholding each
    // ($5,850 future per employer).
    const employerRows: EmployerRow[] = companyRows.map((r) => ({
      streamId: r.streamId,
      company: r.company,
      payFrequency: "biweekly",
      remainingPaychecks: 13,
      remainingGross: 45_000,
      expectedNormalWithholding: 5_850,
    }));

    const projectedAnnualFederalTax = 30_000; // assume from forecastDebug
    const actualWithheldYtd = 11_700; // $5,850 YTD × 2 employers
    const projectedFutureFederalW2Withholding = employerRows.reduce(
      (s, r) => s + r.expectedNormalWithholding,
      0,
    );
    const remainingGap = computeRemainingW4Gap({
      projectedAnnualFederalTax,
      actualWithheldYtd,
      projectedFutureFederalW2Withholding,
      actualTaxSavedOrPaid: 0,
      estimatedPaymentsMade: 0,
      plannedFutureNonW2ReservesCounted: 0,
    });
    // 30,000 - 11,700 - 11,700 = 6,600 underwithheld
    expect(remainingGap).toBe(6_600);

    const totalRemainingGross = employerRows.reduce((s, r) => s + r.remainingGross, 0);
    const allocations = computeAllocations(employerRows, remainingGap, totalRemainingGross);
    expect(allocations).toHaveLength(2);
    // Equal split → each employer ≈ $3,300 / 13 ≈ $254 → rounded to $5 = $255.
    for (const a of allocations) {
      expect(a.step4cPerPaycheck).toBeGreaterThan(0);
    }
    const totalAllocated = allocations.reduce(
      (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
      0,
    );
    // Within rounding tolerance of the gap.
    expect(Math.abs(totalAllocated - remainingGap)).toBeLessThan(150);
  });
});
