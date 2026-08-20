/**
 * Production mixed-income audit fixture
 * 2026 · Head of Household · WA (no state income tax) · DOB 1970-06-15
 * Total projected liability $47,240.09
 * Expected remaining W-4 gap $23,240.09 — the $19,859.13 of *historical*
 * 1099/K-1 recommendations must NOT reduce the gap.
 */
import { describe, it, expect } from "vitest";
import {
  buildW4Reconciliation,
  computeEligibleFutureBusinessReserves,
} from "@/lib/w4Reconciliation";
import { normalizeDateOfBirthInput, sameDateOfBirth } from "@/lib/dateOfBirth";
import {
  computeEmployeeContributionRoom,
  ageAttainedInTaxYear,
  getCatchUpForDateOfBirth,
} from "@/lib/retirementContributionRoom";

const LIABILITY = 47_240.09;
const ACTUAL_W2_WITHHOLDING = 12_000;
const FUTURE_BASELINE_W2 = 8_000;
const ACTUAL_SAVED = 3_000;
const EST_PAYMENTS = 1_000;
const HISTORICAL_RECOMMENDATIONS = 19_859.13;

describe("W-4 reconciliation — production fixture", () => {
  const base = {
    projectedTotalTax: LIABILITY,
    actualW2WithholdingYtd: ACTUAL_W2_WITHHOLDING,
    futureBaselineW2Withholding: FUTURE_BASELINE_W2,
    futureCurrentStep4c: 0,
    actualSavedReserves: ACTUAL_SAVED,
    estimatedPaymentsMade: EST_PAYMENTS,
    eligibleFutureBusinessReserves: 0,
  };

  it("historical 1099/K-1 recommendations never reduce the gap", () => {
    const r = buildW4Reconciliation(base);
    expect(r.remainingGap).toBeCloseTo(23_240.09, 2);
    // Sanity: crediting the historical recommendations would wrongly shrink it.
    expect(r.remainingGap).not.toBeCloseTo(23_240.09 - HISTORICAL_RECOMMENDATIONS, 2);
  });

  it("reconciles to the cent with no residual / no unexplained 'other sources' row", () => {
    const r = buildW4Reconciliation({ ...base, futureCurrentStep4c: 1_500 });
    expect(r.reconciliationDifference).toBe(0);
    const sum = r.credits.reduce((s, c) => s + c.amount, 0) + r.signedRemainingGap;
    expect(sum).toBeCloseTo(LIABILITY, 2);
    expect(r.credits.every((c) => !/other sources/i.test(c.label))).toBe(true);
    expect(r.credits.map((c) => c.label)).toContain(
      "Current extra W-4 withholding on remaining paychecks",
    );
  });

  it("employer targets are Step-4(c)-invariant", () => {
    const a = buildW4Reconciliation({ ...base, futureCurrentStep4c: 0 });
    const b = buildW4Reconciliation({ ...base, futureCurrentStep4c: 5_000 });
    expect(b.gapBeforeStep4c).toBeCloseTo(a.gapBeforeStep4c, 2);
    expect(b.requiredFutureW2Withholding).toBeCloseTo(a.requiredFutureW2Withholding, 2);
    // The adjustment is what shrinks: target − current.
    expect(b.remainingGap).toBeCloseTo(a.remainingGap - 5_000, 2);
  });

  it("over-withholding is reported as a signed surplus, gap floors at 0", () => {
    const r = buildW4Reconciliation({ ...base, futureCurrentStep4c: 40_000 });
    expect(r.remainingGap).toBe(0);
    expect(r.signedRemainingGap).toBeLessThan(0);
    expect(r.reconciliationDifference).toBe(0);
  });
});

describe("eligible future business reserves", () => {
  it("is zero when the include-business-reserves option is OFF", () => {
    expect(
      computeEligibleFutureBusinessReserves({
        enabled: false,
        futureBusinessGross: 100_000,
        reserveRatePct: 30,
        nonW2RemainingNeed: 25_000,
      }),
    ).toBe(0);
  });

  it("credits future Planner reserves when ON, capped by remaining need", () => {
    expect(
      computeEligibleFutureBusinessReserves({
        enabled: true,
        futureBusinessGross: 100_000,
        reserveRatePct: 30,
        nonW2RemainingNeed: 25_000,
      }),
    ).toBeCloseTo(25_000, 2);
    expect(
      computeEligibleFutureBusinessReserves({
        enabled: true,
        futureBusinessGross: 50_000,
        reserveRatePct: 30,
        nonW2RemainingNeed: 25_000,
      }),
    ).toBeCloseTo(15_000, 2);
  });

  it("converted Planner income drops out (future gross excludes actuals)", () => {
    // All planned income converted → future gross 0 → no credit even when ON.
    expect(
      computeEligibleFutureBusinessReserves({
        enabled: true,
        futureBusinessGross: 0,
        reserveRatePct: 30,
        nonW2RemainingNeed: 25_000,
      }),
    ).toBe(0);
  });

  it("only future reserves reduce the gap — ON vs OFF differ by exactly the credit", () => {
    const credit = computeEligibleFutureBusinessReserves({
      enabled: true,
      futureBusinessGross: 40_000,
      reserveRatePct: 30,
      nonW2RemainingNeed: 25_000,
    });
    const off = buildW4Reconciliation({
      projectedTotalTax: LIABILITY,
      actualW2WithholdingYtd: ACTUAL_W2_WITHHOLDING,
      futureBaselineW2Withholding: FUTURE_BASELINE_W2,
      futureCurrentStep4c: 0,
      actualSavedReserves: ACTUAL_SAVED,
      estimatedPaymentsMade: EST_PAYMENTS,
      eligibleFutureBusinessReserves: 0,
    });
    const on = buildW4Reconciliation({
      projectedTotalTax: LIABILITY,
      actualW2WithholdingYtd: ACTUAL_W2_WITHHOLDING,
      futureBaselineW2Withholding: FUTURE_BASELINE_W2,
      futureCurrentStep4c: 0,
      actualSavedReserves: ACTUAL_SAVED,
      estimatedPaymentsMade: EST_PAYMENTS,
      eligibleFutureBusinessReserves: credit,
    });
    expect(off.remainingGap - on.remainingGap).toBeCloseTo(credit, 2);
    expect(on.reconciliationDifference).toBe(0);
  });
});

describe("date of birth — date-only, no UTC drift", () => {
  it("persists 1970-06-15 unchanged", () => {
    expect(normalizeDateOfBirthInput("1970-06-15")).toBe("1970-06-15");
    expect(normalizeDateOfBirthInput(new Date(1970, 5, 15))).toBe("1970-06-15");
    expect(sameDateOfBirth("1970-06-15", "1970-06-15T00:00:00Z")).toBe(true);
  });

  it("ignores empty / partial / impossible values so users without a DOB keep working", () => {
    expect(normalizeDateOfBirthInput("")).toBeNull();
    expect(normalizeDateOfBirthInput("1970-06")).toBeNull();
    expect(normalizeDateOfBirthInput("2026-02-31")).toBeNull();
    expect(normalizeDateOfBirthInput(null)).toBeNull();
    expect(sameDateOfBirth(null, undefined)).toBe(true);
  });
});

describe("2026 employee elective-deferral limits from persisted DOB", () => {
  const room = (dob: string | null) =>
    computeEmployeeContributionRoom({
      taxYear: 2026,
      employeeContributions: [0],
      dateOfBirth: dob,
    }).employeeDeferralLimit;

  it("DOB 1970-06-15 → age 56 in 2026 → $32,500", () => {
    expect(ageAttainedInTaxYear("1970-06-15", 2026)).toBe(56);
    expect(getCatchUpForDateOfBirth(2026, "1970-06-15")).toBe(8_000);
    expect(room("1970-06-15")).toBe(32_500);
  });

  it("under 50 → $24,500; age 60–63 → $35,750", () => {
    expect(room("1990-01-01")).toBe(24_500);
    expect(room("1964-03-02")).toBe(35_750); // age 62
    expect(room(null)).toBe(24_500);
  });

  it("employer contributions stay outside the employee deferral limit", () => {
    const r = computeEmployeeContributionRoom({
      taxYear: 2026,
      employeeContributions: [10_000],
      dateOfBirth: "1970-06-15",
    });
    expect(r.employeeContributionTotal).toBe(10_000);
    expect(r.employeeRemainingRoom).toBe(22_500);
  });
});
