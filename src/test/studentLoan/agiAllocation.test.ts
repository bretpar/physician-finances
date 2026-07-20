import { describe, it, expect } from "vitest";
import { allocateCommunityAgi, isCommunityPropertyState } from "@/lib/studentLoan/communityProperty";
import { compareFilingStatuses } from "@/lib/studentLoan/mfsComparison";

describe("community property AGI allocation", () => {
  it("recognizes Washington as a community property state", () => {
    expect(isCommunityPropertyState("WA")).toBe(true);
    expect(isCommunityPropertyState("wa")).toBe(true);
    expect(isCommunityPropertyState("NY")).toBe(false);
  });

  it("WA MFS: borrower $400k, spouse $0, all community → borrower MFS AGI = $200k", () => {
    const alloc = allocateCommunityAgi({
      borrowerCommunityIncome: 400_000,
      spouseCommunityIncome: 0,
    });
    expect(alloc.totalCommunityIncome).toBe(400_000);
    expect(alloc.borrowerAllocatedCommunity).toBe(200_000);
    expect(alloc.spouseAllocatedCommunity).toBe(200_000);
    expect(alloc.borrowerMfsAgi).toBe(200_000);
    expect(alloc.spouseMfsAgi).toBe(200_000);
  });

  it("Adjustments reduce allocated AGI (not simply half of gross income)", () => {
    // Borrower $400k community + $20k allocated retirement adjustment.
    // Half of gross ignoring adjustments would be $200k. Correct MFS AGI is $180k.
    const alloc = allocateCommunityAgi({
      borrowerCommunityIncome: 400_000,
      spouseCommunityIncome: 0,
      borrowerAdjustments: 20_000,
    });
    expect(alloc.borrowerMfsAgi).toBe(180_000);
    // Spouse also allocated $200k of community income (no adjustments).
    expect(alloc.spouseMfsAgi).toBe(200_000);
  });

  it("Separate-property income adds on top of borrower's allocated community share", () => {
    const alloc = allocateCommunityAgi({
      borrowerCommunityIncome: 300_000,
      spouseCommunityIncome: 100_000,
      borrowerSeparateIncome: 25_000,
      spouseSeparateIncome: 5_000,
    });
    // Community = 400k → each gets 200k
    // Borrower AGI = 200k + 25k = 225k; Spouse = 200k + 5k = 205k
    expect(alloc.borrowerMfsAgi).toBe(225_000);
    expect(alloc.spouseMfsAgi).toBe(205_000);
  });

  it("Custom borrower share overrides the 50/50 default", () => {
    const alloc = allocateCommunityAgi({
      borrowerCommunityIncome: 200_000,
      spouseCommunityIncome: 200_000,
      borrowerCommunityShare: 0.6,
    });
    expect(alloc.borrowerAllocatedCommunity).toBeCloseTo(240_000, 2);
    expect(alloc.spouseAllocatedCommunity).toBeCloseTo(160_000, 2);
  });
});

describe("compareFilingStatuses uses tax engine AGI, not raw income", () => {
  it("MFJ studentLoanAgi equals joint AGI from the tax engine (not total income)", () => {
    const res = compareFilingStatuses({
      userIncome: 400_000,
      spouseIncome: 0,
      loan: { balance: 200_000, interestRatePct: 6 },
      planId: "ibr_new",
      familySize: 2,
      state: "NY",
      applyCommunityRules: false,
      // $20k of above-the-line adjustments → engine AGI should be ~$380k.
      borrowerAdjustments: 20_000,
    });
    expect(res.mfj.studentLoanAgi).toBeLessThan(400_000);
    expect(res.mfj.studentLoanAgi).toBeGreaterThan(370_000);
  });

  it("WA MFS with all-community income: borrower studentLoanAgi ≈ $200k, not $400k", () => {
    const res = compareFilingStatuses({
      userIncome: 400_000,
      spouseIncome: 0,
      loan: { balance: 200_000, interestRatePct: 6 },
      planId: "ibr_new",
      familySize: 2,
      state: "WA",
      applyCommunityRules: true,
    });
    // Borrower MFS AGI should be ~200k community-split (no adjustments).
    expect(res.mfs.studentLoanAgi).toBe(200_000);
    expect(res.communityPropertyApplied).toBe(true);
  });

  it("WA MFS with adjustments uses allocated AGI, not half of gross", () => {
    const res = compareFilingStatuses({
      userIncome: 400_000,
      spouseIncome: 0,
      loan: { balance: 200_000, interestRatePct: 6 },
      planId: "ibr_new",
      familySize: 2,
      state: "WA",
      applyCommunityRules: true,
      borrowerAdjustments: 20_000, // allocated to borrower only
    });
    // Allocated community 200k − 20k = 180k borrower AGI.
    expect(res.mfs.studentLoanAgi).toBe(180_000);
    // Confirm this is NOT simply half of household gross (which would be 200k).
    expect(res.mfs.studentLoanAgi).not.toBe(200_000);
  });

  it("Non-community-property MFS uses borrower's individually earned income (no split)", () => {
    const res = compareFilingStatuses({
      userIncome: 400_000,
      spouseIncome: 0,
      loan: { balance: 200_000, interestRatePct: 6 },
      planId: "ibr_new",
      familySize: 2,
      state: "NY",
      applyCommunityRules: false,
    });
    // Borrower keeps all $400k for MFS AGI (no adjustments).
    expect(res.mfs.studentLoanAgi).toBe(400_000);
  });
});
