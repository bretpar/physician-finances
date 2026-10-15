import { describe, it, expect } from "vitest";
import {
  computeCatchUpRecommendation,
  countRemainingOpportunities,
  expectedOrdinaryCoverageForEvents,
} from "@/lib/catchUpRecommendation";
import {
  computeCanonicalEventRecommendation,
  computeFutureOccurrenceOrdinaryCoverage,
} from "@/lib/canonicalEventRecommendation";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";
import type { TaxEstimate } from "@/lib/taxEngine";

/** $300k W-2 + $100k K-1 household. */
const estimate = {
  federalTax: 40000, federalTaxBeforeCredits: 40000, ordinaryFederalTaxBeforeCredits: 40000,
  preferentialFederalTaxBeforeCredits: 0, preferentialTaxableIncome: 0,
  seTax: { total: 14130 }, personalStateTax: 0, businessStateTax: 0,
  totalIncome: 400000, taxableIncome: 400000, w2Income: 300000, w2TaxableIncomeBase: 300000,
  grossBusinessIncome: 100000, netBusinessProfit: 100000, seIncome: 100000, otherIncome: 0,
  totalTaxLiability: 54130,
} as unknown as TaxEstimate;
const settings = { withholdingMethod: "dynamic_planner", stateIncomeTaxEnabled: false } as any;

const now = new Date(2026, 7, 1);
const deadline = new Date(2026, 8, 15);
const cov = (o: any) =>
  computeFutureOccurrenceOrdinaryCoverage({
    estimate, taxSettings: settings, occurrence: o,
    stateTaxIncludedInTarget: false, w2FundingMethod: "paycheck_target",
  });

describe("catch-up uses canonical future coverage", () => {
  it("$1,000 target with two $500 ordinary future reserves → $0 catch-up", () => {
    const events = [
      { date: "2026-08-15T12:00:00", grossAmount: 2000, ordinaryCoverage: 500 },
      { date: "2026-09-01T12:00:00", grossAmount: 2000, ordinaryCoverage: 500 },
    ];
    const ordinary = expectedOrdinaryCoverageForEvents(events, now, deadline);
    expect(ordinary).toBe(1000);
    const r = computeCatchUpRecommendation({
      quarterTarget: 1000, coveredSoFar: 0,
      remainingOpportunities: countRemainingOpportunities(events, now, deadline),
      expectedOrdinaryCoverage: ordinary,
    });
    expect(r.quarterlyAdjustmentAmount).toBe(0);
  });

  it("mixed W-2/K-1: future coverage equals the sum of canonical event results, not the blended rate", () => {
    const w2 = { date: "2026-08-15T12:00:00", grossAmount: 60000, streamCompanyType: "w2" };
    const k1 = { date: "2026-09-01T12:00:00", grossAmount: 5000, streamCompanyType: "K1" };
    const canonical = (o: any, bucket: "personal" | "business") =>
      computeCanonicalEventRecommendation({
        estimate, taxSettings: settings, incomeType: o.streamCompanyType, incomeBucket: bucket,
        grossIncome: o.grossAmount, creditedWithholding: 0, catchUpAmount: 0,
        isFutureOpportunity: true, w2FundingMethod: "paycheck_target",
      })!.recommendedWithholding;
    const expected = Math.round((canonical(w2, "personal") + canonical(k1, "business")) * 100) / 100;
    const events = [w2, k1].map((o) => ({ ...o, ordinaryCoverage: cov(o) }));
    const actual = expectedOrdinaryCoverageForEvents(events, now, deadline);
    expect(actual).toBeCloseTo(expected, 2);
    const blended = expectedOrdinaryCoverageForEvents([w2, k1], now, deadline, 54130 / 400000);
    expect(Math.abs(blended - actual)).toBeGreaterThan(1);
  });

  it("converted / matched / suggested occurrences are not counted again", () => {
    const events = [
      { date: "2026-08-15T12:00:00", grossAmount: 2000, matchStatus: "converted", ordinaryCoverage: 500 },
      { date: "2026-08-20T12:00:00", grossAmount: 2000, matchStatus: "matched", ordinaryCoverage: 500 },
      { date: "2026-08-25T12:00:00", grossAmount: 2000, matchStatus: "suggested", ordinaryCoverage: 500 },
      { date: "2026-09-01T12:00:00", grossAmount: 2000, matchStatus: "active", ordinaryCoverage: 500 },
    ];
    expect(expectedOrdinaryCoverageForEvents(events, now, deadline)).toBe(500);
    const q = buildQuarterRecommendation({
      year: 2026, quarter: 3, annualTaxLiability: 4000, quarterMethod: "even",
      projectedPaychecks: events as any, now,
    } as any);
    expect(q.expectedOrdinaryCoverage).toBe(500);
  });

  it("remaining opportunity count uses the same eligibility as coverage", () => {
    const events = [
      { date: "2026-07-15T12:00:00", grossAmount: 1, ordinaryCoverage: 100 }, // past
      { date: "2026-08-15T12:00:00", grossAmount: 1, matchStatus: "converted", ordinaryCoverage: 100 },
      { date: "2026-08-20T12:00:00", grossAmount: 1, isSkipped: true, ordinaryCoverage: 100 },
      { date: "2026-09-01T12:00:00", grossAmount: 1, ordinaryCoverage: 100 },
      { date: "2026-09-10T12:00:00", grossAmount: 1, ordinaryCoverage: 100 },
      { date: "2026-10-01T12:00:00", grossAmount: 1, ordinaryCoverage: 100 }, // after deadline
    ];
    expect(countRemainingOpportunities(events, now, deadline)).toBe(2);
    expect(expectedOrdinaryCoverageForEvents(events, now, deadline)).toBe(200);
  });

  it("normal event recommendation is unchanged with catch-up disabled", () => {
    const base = {
      estimate, taxSettings: settings, incomeType: "K1", incomeBucket: "business" as const,
      grossIncome: 5000, creditedWithholding: 0, isFutureOpportunity: true,
    };
    const a = computeCanonicalEventRecommendation({ ...base, catchUpAmount: 0 })!;
    const b = computeCanonicalEventRecommendation({ ...base })!;
    expect(a.recommendedWithholding).toBe(b.recommendedWithholding);
    expect(a.catchUpApplied).toBe(0);
    expect(cov({ grossAmount: 5000, streamCompanyType: "K1" })).toBe(a.recommendedWithholding);
  });
});
