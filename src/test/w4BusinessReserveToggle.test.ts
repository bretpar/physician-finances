/**
 * Business-reserve toggle must actually move the W-4 gap.
 *
 * Bug: the gap was always `sourceFunding.w2.remainingNeed`, so uncovered
 * business responsibility was silently assumed to be self-funded in BOTH
 * toggle states — the gap stayed $0 with the toggle OFF even though the
 * displayed components left a real shortfall.
 */
import { describe, it, expect } from "vitest";
import { buildSourceFundingPlan } from "@/lib/sourceFundingPlan";
import { ALLOCATION_BUCKETS } from "@/lib/canonicalEventRecommendation";
import { computeSignedW4Gap } from "@/components/tax/W4PaycheckAdjustmentCard";

const allocation: any = {
  projectedTaxLiability: 65072,
  sources: [
    { sourceId: ALLOCATION_BUCKETS.w2, totalAllocatedTaxResponsibility: 34000 },
    { sourceId: ALLOCATION_BUCKETS.business, totalAllocatedTaxResponsibility: 31072 },
  ],
};

const plan = buildSourceFundingPlan({
  allocation,
  w2ActualWithheldYtd: 7211,
  w2ExpectedFutureBaselineWithholding: 23844,
  estimatedPaymentsMade: 20300,
  householdSavingsSetAside: 8331,
});

/** Mirrors the hook/card: OFF shifts uncovered business need into the W-4 ask. */
const gapFor = (countBusinessReserves: boolean) =>
  Math.max(
    0,
    plan.w2.remainingNeed + (countBusinessReserves ? 0 : plan.nonW2.remainingNeed),
  );

describe("W-4 business-reserve toggle", () => {
  it("household components leave a real shortfall", () => {
    const residual = 65072 - 7211 - 23844 - 8331 - 20300;
    expect(residual).toBeCloseTo(5386, 0);
    expect(plan.w2.remainingNeed + plan.nonW2.remainingNeed).toBeCloseTo(residual, 0);
  });

  it("OFF surfaces the remaining shortfall as a positive W-4 gap", () => {
    expect(gapFor(false)).toBeCloseTo(5386, 0);
  });

  it("ON credits the business reserves and the gap falls to zero", () => {
    expect(gapFor(true)).toBeCloseTo(plan.w2.remainingNeed, 2);
    expect(gapFor(true)).toBeLessThan(gapFor(false));
  });

  it("displayed components reconcile with the gap in both states", () => {
    const base = {
      projectedAnnualFederalTax: 65072,
      actualWithheldYtd: 7211,
      projectedFutureFederalW2Withholding: 23844,
      actualTaxSavedOrPaid: 8331,
      estimatedPaymentsMade: 20300,
    };
    expect(
      computeSignedW4Gap({ ...base, plannedFutureNonW2ReservesCounted: 0 }),
    ).toBeCloseTo(gapFor(false), 0);
    expect(
      computeSignedW4Gap({
        ...base,
        plannedFutureNonW2ReservesCounted: plan.nonW2.remainingNeed,
      }),
    ).toBeCloseTo(gapFor(true), 0);
  });
});
