/**
 * Regression: Saved W-2 companies in Settings must feed the Tax Overview /
 * W-4 projected income even when no projected_income_stream exists.
 *
 * Scenario (Single WA, W-2 only, two saved companies, no active streams):
 *   - Evergreen Medical Group: $90k annual, biweekly, $450 fed/paycheck,
 *     YTD gross $45k, YTD fed $5,850
 *   - Harbor Emergency Physicians: same shape
 */
import { describe, expect, it } from "vitest";
import {
  computeSavedW2CompanyProjectionAddon,
  ytdCompanyKey,
  type SavedW2CompanyInput,
} from "@/lib/savedW2CompanyProjection";
import {
  buildCompanyOnlyEmployerRows,
  computeRemainingW4Gap,
  computeAllocations,
  normalizeEmployerName,
} from "@/components/tax/W4PaycheckAdjustmentCard";

const companies: SavedW2CompanyInput[] = [
  {
    id: "co-1",
    name: "Evergreen Medical Group",
    companyType: "w2",
    payFrequency: "biweekly",
    projectedAnnualGross: 90_000,
    expectedFederalWithholdingPerPaycheck: 450,
  },
  {
    id: "co-2",
    name: "Harbor Emergency Physicians",
    companyType: "w2",
    payFrequency: "biweekly",
    projectedAnnualGross: 90_000,
    expectedFederalWithholdingPerPaycheck: 450,
  },
];

const ytdGrossByCompanyKey = new Map<string, number>([
  [ytdCompanyKey("Evergreen Medical Group"), 45_000],
  [ytdCompanyKey("Harbor Emergency Physicians"), 45_000],
]);

describe("Saved W-2 company projection — two-$90k scenario", () => {
  it("recognizes both saved companies as W-2 employers and builds W-4 rows", () => {
    const rows = buildCompanyOnlyEmployerRows(
      companies.map((c) => ({
        name: c.name,
        companyType: c.companyType,
        payFrequency: c.payFrequency,
      })),
      new Set<string>(),
    );
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.company).sort()).toEqual([
      "Evergreen Medical Group",
      "Harbor Emergency Physicians",
    ]);
    for (const r of rows) expect(r.__isYtdFallback).toBe(true);
  });

  it("addon contributes the remaining-year gross when no stream covers the company", () => {
    const addon = computeSavedW2CompanyProjectionAddon({
      companies,
      coveredCompanyIds: new Set<string>(),
      ytdGrossByCompanyKey,
      remainingPaychecksFor: () => 13, // doesn't matter for gross
    });
    // 90k - 45k for each company
    expect(addon.futureGross).toBe(90_000);
    expect(addon.perCompany.length).toBe(2);
  });

  it("addon adds projected federal withholding from saved per-paycheck amount", () => {
    const addon = computeSavedW2CompanyProjectionAddon({
      companies,
      coveredCompanyIds: new Set<string>(),
      ytdGrossByCompanyKey,
      remainingPaychecksFor: () => 13,
    });
    // 13 remaining * $450 * 2 employers
    expect(addon.futureFederalWithheld).toBe(13 * 450 * 2);
  });

  it("skips companies already covered by an active projected stream (no double count)", () => {
    const addon = computeSavedW2CompanyProjectionAddon({
      companies,
      coveredCompanyIds: new Set<string>(["co-1"]),
      ytdGrossByCompanyKey,
      remainingPaychecksFor: () => 13,
    });
    expect(addon.perCompany.length).toBe(1);
    expect(addon.perCompany[0].companyId).toBe("co-2");
    expect(addon.futureGross).toBe(45_000);
  });

  it("skips non-W-2 company types", () => {
    const addon = computeSavedW2CompanyProjectionAddon({
      companies: [
        {
          id: "x",
          name: "Side Gig LLC",
          companyType: "1099_schedule_c",
          payFrequency: null,
          projectedAnnualGross: 50_000,
          expectedFederalWithholdingPerPaycheck: 0,
        },
      ],
      coveredCompanyIds: new Set<string>(),
      ytdGrossByCompanyKey: new Map(),
      remainingPaychecksFor: () => 13,
    });
    expect(addon.futureGross).toBe(0);
    expect(addon.perCompany.length).toBe(0);
  });

  it("combined projected gross + YTD reflects ~$180k household W-2 income", () => {
    const ytdSum = Array.from(ytdGrossByCompanyKey.values()).reduce(
      (s, v) => s + v,
      0,
    );
    const addon = computeSavedW2CompanyProjectionAddon({
      companies,
      coveredCompanyIds: new Set<string>(),
      ytdGrossByCompanyKey,
      remainingPaychecksFor: () => 13,
    });
    expect(ytdSum + addon.futureGross).toBe(180_000);
  });

  it("W-4 row + allocation pipeline produces an explainable gap for the saved-company-only scenario", () => {
    const rows = buildCompanyOnlyEmployerRows(
      companies.map((c) => ({
        name: c.name,
        companyType: c.companyType,
        payFrequency: c.payFrequency,
      })),
      new Set<string>(),
    );
    // Simulate `effectiveRows` after settings overlay: 13 remaining paychecks
    // per employer, $3,461.54 gross each, $450 expected withholding each.
    const eff = rows.map((r) => ({
      ...r,
      remainingPaychecks: 13,
      remainingGross: 45_000,
      expectedNormalWithholding: 13 * 450,
    }));
    const totalRemainingW2Gross = eff.reduce((s, r) => s + r.remainingGross, 0);
    const projectedAnnualFederalTax = 28_000; // illustrative
    const actualWithheldYtd = 11_700; // 5_850 * 2
    const projectedFutureFederalW2Withholding = eff.reduce(
      (s, r) => s + r.expectedNormalWithholding,
      0,
    );
    const gap = computeRemainingW4Gap({
      projectedAnnualFederalTax,
      actualWithheldYtd,
      projectedFutureFederalW2Withholding,
      actualTaxSavedOrPaid: 0,
      estimatedPaymentsMade: 0,
      plannedFutureNonW2ReservesCounted: 0,
    });
    // 28000 - 11700 - 11700 = 4600
    expect(gap).toBe(4_600);
    const allocs = computeAllocations(eff, gap, totalRemainingW2Gross);
    expect(allocs.length).toBe(2);
    const totalExtra = allocs.reduce(
      (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
      0,
    );
    // Should approximately recover the gap (rounding to nearest $5/paycheck)
    expect(totalExtra).toBeGreaterThanOrEqual(gap - 13 * 5 * 2);
    expect(totalExtra).toBeLessThanOrEqual(gap + 13 * 5 * 2);
  });

  it("normalizeEmployerName + ytdCompanyKey both lowercase/trim consistently", () => {
    expect(normalizeEmployerName("  Evergreen Medical Group  ").toLowerCase()).toBe(
      ytdCompanyKey(" Evergreen Medical Group "),
    );
  });
});
