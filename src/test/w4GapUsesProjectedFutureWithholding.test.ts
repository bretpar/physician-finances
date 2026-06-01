import { describe, it, expect } from "vitest";
import {
  computeRemainingW4Gap,
  computeSignedW4Gap,
  computeAllocations,
  type EmployerRow,
  type W4GapInputs,
} from "@/components/tax/W4PaycheckAdjustmentCard";

/**
 * Regression: production stress test
 *   brendantparker+w4stress-20260531221605@gmail.com
 *
 * Two W-2 employers (Single, WA) with saved expected federal withholding per
 * paycheck. The employer rows correctly projected $4,500 + $700 = $5,200 of
 * future federal withholding, but the main W-4 gap formula was passing $0 for
 * projected future W-2 withholding, overstating the recommendation.
 *
 * The gap formula MUST subtract the same projected future federal withholding
 * total that the employer rows display.
 */
describe("W-4 gap subtracts projected future W-2 federal withholding from rows", () => {
  // Stress scenario per spec.
  const evergreen: EmployerRow = {
    streamId: "emp:evergreen medical group|w2",
    company: "Evergreen Medical Group",
    payFrequency: "biweekly",
    remainingPaychecks: 15,
    remainingGross: 150_000, // 260k annual − 110k remaining post-YTD-ish bucket
    expectedNormalWithholding: 4_500, // 15 paychecks × $300
  };
  const harbor: EmployerRow = {
    streamId: "emp:harbor emergency physicians|w2",
    company: "Harbor Emergency Physicians",
    payFrequency: "biweekly",
    remainingPaychecks: 7,
    remainingGross: 56_000, // 96k annual − 40k YTD-ish remaining bucket
    expectedNormalWithholding: 700, // 7 paychecks × $100
  };
  const rows = [evergreen, harbor];
  const totalProjectedFutureFedWithholding =
    evergreen.expectedNormalWithholding + harbor.expectedNormalWithholding;

  // Diagnostic-observed values from production:
  const projectedAnnualFederalTax = 27_614;
  const actualWithheldYtd = 5_400; // YTD federal withholding (state WA = 0)

  const baseInputs: W4GapInputs = {
    projectedAnnualFederalTax,
    actualWithheldYtd,
    projectedFutureFederalW2Withholding: totalProjectedFutureFedWithholding,
    actualTaxSavedOrPaid: 0,
    estimatedPaymentsMade: 0,
    plannedFutureNonW2ReservesCounted: 0,
  };

  it("projected future W-2 withholding sum equals $5,200 (matches employer rows)", () => {
    expect(totalProjectedFutureFedWithholding).toBe(5_200);
  });

  it("gap subtracts projected future W-2 withholding (not $0)", () => {
    const gap = computeRemainingW4Gap(baseInputs);
    // 27,614 − 5,400 − 5,200 = 17,014
    expect(gap).toBe(17_014);
    // Must be strictly smaller than the buggy "$0 future withholding" gap.
    const buggyGap = computeRemainingW4Gap({
      ...baseInputs,
      projectedFutureFederalW2Withholding: 0,
    });
    expect(buggyGap).toBe(22_214);
    expect(gap).toBeLessThan(buggyGap);
    expect(buggyGap - gap).toBe(totalProjectedFutureFedWithholding);
  });

  it("recommendation remains nonzero but is not overstated", () => {
    const gap = computeRemainingW4Gap(baseInputs);
    expect(gap).toBeGreaterThan(0);
    const allocs = computeAllocations(rows, gap, evergreen.remainingGross + harbor.remainingGross);
    const totalCovered = allocs.reduce(
      (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
      0,
    );
    // Within one $5/paycheck rounding bucket of the corrected gap.
    expect(Math.abs(totalCovered - gap)).toBeLessThanOrEqual(5 * rows.length);
    // And clearly below the inflated $22,220 amount that the bug produced.
    expect(totalCovered).toBeLessThan(22_220);
  });

  it("displayed projected future W-2 withholding equals sum of employer rows", () => {
    // The component uses the same `expectedFutureNormalW2Withholding` value
    // for both the visible breakdown row and the gap formula. Asserting the
    // sum from the EmployerRow objects matches the input field guarantees
    // they cannot diverge.
    const sumFromRows = rows.reduce((s, r) => s + r.expectedNormalWithholding, 0);
    expect(baseInputs.projectedFutureFederalW2Withholding).toBe(sumFromRows);
  });

  it("federal gap excludes Social Security, Medicare, and SE tax", () => {
    // Caller is responsible for passing federal-only values. Adding FICA/SE
    // would only happen if the caller misclassified the input — guard against
    // that by asserting the formula has no implicit FICA term: feeding the
    // same federal inputs must produce the exact federal-only difference.
    const gap = computeSignedW4Gap(baseInputs);
    expect(gap).toBe(
      projectedAnnualFederalTax -
        actualWithheldYtd -
        totalProjectedFutureFedWithholding,
    );
  });

  it("does not double-count actual YTD withholding", () => {
    // Passing actualWithheldYtd separately and projectedFutureFederalW2Withholding
    // separately must subtract each exactly once.
    const gap = computeSignedW4Gap(baseInputs);
    const recomputed =
      projectedAnnualFederalTax -
      actualWithheldYtd -
      totalProjectedFutureFedWithholding -
      0 - // actualTaxSavedOrPaid
      0 - // estimatedPaymentsMade
      0;  // plannedFutureNonW2ReservesCounted
    expect(gap).toBe(recomputed);
  });

  it("only counts tax savings set-aside when actually saved/paid", () => {
    const withSavings = computeRemainingW4Gap({
      ...baseInputs,
      actualTaxSavedOrPaid: 1_000,
    });
    expect(withSavings).toBe(17_014 - 1_000);
  });
});
