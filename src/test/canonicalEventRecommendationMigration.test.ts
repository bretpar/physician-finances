/**
 * Canonical per-event recommendation — migration invariants.
 *
 * Every user-facing recommendation surface now routes through
 * `computeCanonicalEventRecommendation` / `getCanonicalBucketRatePct`.
 * These tests lock the product rules that migration exists to guarantee.
 */
import { describe, it, expect } from "vitest";
import {
  computeCanonicalEventRecommendation,
  getCanonicalBucketRatePct,
} from "@/lib/canonicalEventRecommendation";
import type { TaxEstimate } from "@/lib/taxEngine";

/** Household: $300k W-2 + $100k 1099 profit, $54,130 total liability. */
function estimate(over: Partial<TaxEstimate> = {}): TaxEstimate {
  return {
    federalTax: 40000,
    federalTaxBeforeCredits: 40000,
    ordinaryFederalTaxBeforeCredits: 40000,
    preferentialFederalTaxBeforeCredits: 0,
    preferentialTaxableIncome: 0,
    seTax: { total: 14130 },
    personalStateTax: 0,
    businessStateTax: 0,
    totalIncome: 400000,
    taxableIncome: 400000,
    w2Income: 300000,
    w2TaxableIncomeBase: 300000,
    grossBusinessIncome: 100000,
    netBusinessProfit: 100000,
    seIncome: 100000,
    otherIncome: 0,
    totalTaxLiability: 54130,
    ...over,
  } as unknown as TaxEstimate;
}

const settings = {
  withholdingMethod: "dynamic_planner",
  stateIncomeTaxEnabled: false,
  businessStateTaxEnabled: false,
} as any;

const baseEvent = {
  estimate: estimate(),
  taxSettings: settings,
  creditedWithholding: 0,
  catchUpAmount: 0,
  isFutureOpportunity: true,
} as const;

describe("canonical event recommendation — allocation is the source of truth", () => {
  it("uses the progressive-derived allocation rate, not a marginal bracket", () => {
    // $40k federal over a $400k combined base = 10% — a marginal approach
    // would have charged 32%/35%.
    const rec = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "w2",
      incomeBucket: "personal",
      grossIncome: 10000,
      w2FundingMethod: "paycheck_target",
    })!;
    expect(rec.basis).toBe("canonical_allocation");
    expect(rec.eventTaxTarget).toBeCloseTo(1000, 0);
  });

  it("keeps SE tax off W-2 events and on business events", () => {
    const w2Rate = getCanonicalBucketRatePct({
      estimate: estimate(),
      taxSettings: settings,
      bucket: "personal",
      incomeType: "W2",
    });
    const bizRate = getCanonicalBucketRatePct({
      estimate: estimate(),
      taxSettings: settings,
      bucket: "business",
      incomeType: "1099",
    });
    expect(w2Rate).toBeCloseTo(10, 1);
    expect(bizRate).toBeGreaterThan(w2Rate);
  });

  it("bucket rate matches the per-event recommendation for the same bucket", () => {
    const rate = getCanonicalBucketRatePct({
      estimate: estimate(),
      taxSettings: settings,
      bucket: "business",
      incomeType: "1099",
      referenceAmount: 10000,
    });
    const rec = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "1099",
      incomeBucket: "business",
      grossIncome: 10000,
      includeSETaxInRecommendation: true,
    })!;
    expect(rate).toBeCloseTo(rec.effectiveRatePct, 2);
  });
});

describe("catch-up rules", () => {
  it("never gives a historical event a future catch-up allocation", () => {
    const past = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "1099",
      incomeBucket: "business",
      grossIncome: 10000,
      catchUpAmount: 900,
      isFutureOpportunity: false,
      annualRemainingTax: 50000,
    })!;
    expect(past.catchUpApplied).toBe(0);
  });

  it("applies catch-up to a future event, clamped to the remaining liability", () => {
    const future = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "1099",
      incomeBucket: "business",
      grossIncome: 10000,
      catchUpAmount: 900,
      isFutureOpportunity: true,
      annualRemainingTax: 50000,
    })!;
    expect(future.catchUpApplied).toBeGreaterThan(0);
    expect(future.catchUpApplied).toBeLessThanOrEqual(900);

    const capped = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "1099",
      incomeBucket: "business",
      grossIncome: 10000,
      catchUpAmount: 900,
      isFutureOpportunity: true,
      annualRemainingTax: 0,
    })!;
    expect(capped.catchUpApplied).toBe(0);
  });
});

describe("W-2 funding method", () => {
  it("annual_w4 hands the deficit to the W-4 card instead of a second savings ask", () => {
    const rec = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "w2",
      incomeBucket: "personal",
      grossIncome: 10000,
      w2FundingMethod: "annual_w4",
    })!;
    expect(rec.fundedByAnnualW4).toBe(true);
    expect(rec.recommendedWithholding).toBe(0);
  });

  it("paycheck_target still produces a per-paycheck ask", () => {
    const rec = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "w2",
      incomeBucket: "personal",
      grossIncome: 10000,
      w2FundingMethod: "paycheck_target",
    })!;
    expect(rec.fundedByAnnualW4).toBe(false);
    expect(rec.recommendedWithholding).toBeGreaterThan(0);
  });

  it("credits withholding already applied to the event (never FICA)", () => {
    const rec = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "w2",
      incomeBucket: "personal",
      grossIncome: 10000,
      w2FundingMethod: "paycheck_target",
      creditedWithholding: 5000,
    })!;
    expect(rec.recommendedWithholding).toBe(0);
    expect(rec.signedRecommendation).toBeLessThan(0);
  });
});

describe("historical events never receive an actionable funding ask", () => {
  it("zeroes recommendedWithholding for a past 1099 event but keeps the shortfall for display", () => {
    const past = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "1099",
      incomeBucket: "business",
      grossIncome: 10000,
      includeSETaxInRecommendation: true,
      isFutureOpportunity: false,
      annualRemainingTax: 50000,
    })!;
    expect(past.isFutureOpportunity).toBe(false);
    expect(past.recommendedFutureFunding).toBe(0);
    expect(past.recommendedWithholding).toBe(0);
    expect(past.historicalTarget).toBeGreaterThan(0);
    expect(past.historicalShortfall).toBeGreaterThan(0);
  });

  it("still asks a future 1099 event to fund its own share", () => {
    const future = computeCanonicalEventRecommendation({
      ...baseEvent,
      incomeType: "1099",
      incomeBucket: "business",
      grossIncome: 10000,
      includeSETaxInRecommendation: true,
      isFutureOpportunity: true,
      annualRemainingTax: 50000,
    })!;
    expect(future.recommendedFutureFunding).toBeGreaterThan(0);
    expect(future.recommendedWithholding).toBe(future.recommendedFutureFunding);
  });
});
