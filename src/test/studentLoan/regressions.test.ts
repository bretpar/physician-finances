/**
 * Regression suite covering the QA defects reported against production
 * commit be4e503:
 *   1. Household/spouse income double-counting in MFJ vs MFS
 *   2. State → PovertyRegion (AK/HI) reaches the calculation engine
 *   3. Hawaii 2026 per-additional-person = $6,530
 *   4. AGI adjustments included in WA MFS allocation
 *   5. Fixed-term Standard 10 shows exactly 120 months (no off-by-one)
 *   6. Graduated 10-Year does not fabricate a 38-year payoff
 *   7. MFS uses real MFS brackets (not two singles) at the divergence point
 */

import { describe, it, expect } from "vitest";
import { compareFilingStatuses } from "@/lib/studentLoan/mfsComparison";
import { estimateRepayment } from "@/lib/studentLoan/calculator";
import { getPovertyTable } from "@/lib/studentLoan/rules/povertyGuidelines";

const baseLoan = { balance: 200_000, interestRatePct: 6.5 };
const baseBorrower = {
  filingStatus: "single" as const,
  familySize: 1,
  annualIncome: 250_000,
};

describe("regression: household/spouse double-counting", () => {
  it("MFJ scenario income = borrower + spouse, never (household + spouse)", () => {
    // Household budget: borrower 300k, spouse 100k → MFJ combined = 400k.
    const res = compareFilingStatuses({
      userIncome: 300_000,
      spouseIncome: 100_000,
      loan: baseLoan,
      planId: "paye",
      familySize: 2,
      state: "NY",
      applyCommunityRules: false,
    });
    // MFJ AGI (no adjustments) equals combined 400k, not 500k or 700k.
    expect(res.mfj.studentLoanAgi).toBeGreaterThan(390_000);
    expect(res.mfj.studentLoanAgi).toBeLessThan(410_000);
  });
});

describe("regression: state → poverty region", () => {
  it("Hawaii 2026 per-additional-person is $6,530 (not $6,540)", () => {
    const t = getPovertyTable(2026, "hawaii");
    expect(t.perAdditionalPerson).toBe(6530);
  });

  it("Alaska/Hawaii selection changes the discretionary poverty guideline in the estimate", () => {
    // Use a low balance so the Std-10 cap doesn't equalise the two.
    const contiguous = estimateRepayment(
      { balance: 30_000, interestRatePct: 6 },
      { ...baseBorrower, annualIncome: 80_000, familySize: 2, region: "contiguous_48_dc" },
      "ibr_new",
    );
    const alaska = estimateRepayment(
      { balance: 30_000, interestRatePct: 6 },
      { ...baseBorrower, annualIncome: 80_000, familySize: 2, region: "alaska" },
      "ibr_new",
    );
    // Alaska's higher poverty guideline → lower discretionary → lower payment.
    expect(alaska.discretionaryIncome!).toBeLessThan(contiguous.discretionaryIncome!);
    expect(alaska.estimatedMonthlyPayment).toBeLessThan(contiguous.estimatedMonthlyPayment);
  });
});

describe("regression: MFS AGI adjustments in a community-property state", () => {
  it("WA MFS with borrower adjustments produces AGI below simple half-of-gross", () => {
    const res = compareFilingStatuses({
      userIncome: 400_000,
      spouseIncome: 0,
      loan: baseLoan,
      planId: "ibr_new",
      familySize: 2,
      state: "WA",
      applyCommunityRules: true,
      borrowerAdjustments: 20_000,
    });
    // 400k community → borrower allocated 200k − 20k adjustments = 180k.
    expect(res.mfs.studentLoanAgi).toBe(180_000);
    expect(res.communityPropertyApplied).toBe(true);
  });
});

describe("regression: fixed-term / graduated payoff display", () => {
  it("Standard 10-Year reports exactly 120 months (no off-by-one)", () => {
    const est = estimateRepayment(baseLoan, baseBorrower, "standard_10");
    expect(est.estimatedPayoffMonths).toBe(120);
  });

  it("Extended 25 reports 300 months", () => {
    const est = estimateRepayment(
      { balance: 100_000, interestRatePct: 6 },
      baseBorrower,
      "extended_25",
    );
    expect(est.estimatedPayoffMonths).toBe(300);
  });

  it("Graduated 10-Year does NOT fabricate a multi-decade payoff", () => {
    const est = estimateRepayment(baseLoan, baseBorrower, "graduated_10");
    expect(est.estimatedPayoffMonths).toBeNull();
  });
});

describe("regression: MFS uses MFS brackets, not two singles", () => {
  it("MFS federal tax on a $500k single-income household exceeds the single-bracket approximation", () => {
    // Single 2026: 35% bracket 256,225–640,600; MFS: 35% ends at 384,350.
    // A $500k slice partially crosses into 37% under MFS but stays in 35%
    // under single — MFS tax must be measurably higher than the pre-fix
    // "two singles" approximation would have produced.
    const res = compareFilingStatuses({
      userIncome: 500_000,
      spouseIncome: 0,
      loan: baseLoan,
      planId: "ibr_new",
      familySize: 1,
      state: "NY",
      applyCommunityRules: false,
    });
    // Single-filer approximation on $500k ≈ $138k. MFS lands >$140k.
    expect(res.mfs.federalTax).toBeGreaterThan(140_000);
  });
});
