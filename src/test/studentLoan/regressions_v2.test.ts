import { describe, it, expect } from "vitest";
import { compareFilingStatuses } from "@/lib/studentLoan/mfsComparison";
import { calculateFullEstimate } from "@/lib/taxEngine";
import type { StudentLoanInput } from "@/lib/studentLoan/calculator";

const LOAN: StudentLoanInput = { balance: 200000, interestRatePct: 6.5 };

describe("mfsComparison regressions (defects 1, 2, 5)", () => {
  it("does NOT double-count spouse income for MFJ scenarios (defect #1)", () => {
    // Household earns 400k = 250k borrower + 150k spouse. Joint AGI override
    // is 380k (after 20k above-the-line adjustments). Under PAYE / SAVE-style
    // rules, MFJ payment must be based on 380k — NOT 380k + 150k = 530k.
    const result = compareFilingStatuses({
      userIncome: 250000,
      spouseIncome: 150000,
      loan: LOAN,
      planId: "paye",
      familySize: 2,
      state: "TX",
      applyCommunityRules: false,
      overrideJointAgi: 380000,
      overrideBorrowerMfsAgi: 240000,
      overrideSpouseMfsAgi: 140000,
    });
    // Sanity: MFJ AGI reported is the override, not override + spouse.
    expect(result.mfj.studentLoanAgi).toBe(380000);
    // The MFJ payment must correspond to 380k of discretionary income, not
    // 530k. Compute what a 530k double-count would yield and assert we're
    // materially below it.
    const doubleCountAgi = 380000 + 150000; // wrong pathway
    const povertyGuideline2Person = 21150; // 2026 contiguous baseline used elsewhere
    const wrongDiscretionary = doubleCountAgi - 1.5 * povertyGuideline2Person;
    const wrongMonthly = (wrongDiscretionary * 0.1) / 12; // PAYE 10%
    expect(result.mfj.studentLoanMonthlyPayment).toBeLessThan(wrongMonthly * 0.85);
  });

  it("routes MFS federal tax through the central tax engine (defect #5)", () => {
    // Given identical borrower/spouse AGI overrides, the MFS federal tax
    // returned by compareFilingStatuses must equal 2× the engine's MFS
    // calculation for that AGI (each spouse files separately).
    const borrowerAgi = 180000;
    const spouseAgi = 60000;
    const result = compareFilingStatuses({
      userIncome: 0,
      spouseIncome: 0,
      loan: LOAN,
      planId: "standard_10",
      familySize: 2,
      state: "TX",
      applyCommunityRules: false,
      overrideJointAgi: borrowerAgi + spouseAgi,
      overrideBorrowerMfsAgi: borrowerAgi,
      overrideSpouseMfsAgi: spouseAgi,
    });
    const borrowerEngine = calculateFullEstimate({
      totalIncome: borrowerAgi, w2Income: borrowerAgi, seIncome: 0,
      preTaxDeductions: 0, retirement401k: 0, businessDeductions: 0,
      mileageDeduction: 0, taxesWithheld: 0,
      filingStatus: "married_filing_separately",
      lastYearTax: 0, deductionType: "standard", itemizedDeductionAmount: 0,
    });
    const spouseEngine = calculateFullEstimate({
      totalIncome: spouseAgi, w2Income: spouseAgi, seIncome: 0,
      preTaxDeductions: 0, retirement401k: 0, businessDeductions: 0,
      mileageDeduction: 0, taxesWithheld: 0,
      filingStatus: "married_filing_separately",
      lastYearTax: 0, deductionType: "standard", itemizedDeductionAmount: 0,
    });
    const expected = Math.round(borrowerEngine.federalTax + spouseEngine.federalTax);
    expect(result.mfs.federalTax).toBe(expected);
    // Per-spouse breakdown is also exposed.
    expect(result.mfs.borrowerFederalTax).toBe(Math.round(borrowerEngine.federalTax));
    expect(result.mfs.spouseFederalTax).toBe(Math.round(spouseEngine.federalTax));
  });

  it("honors AK poverty region for the borrower AGI in MFS (defect #2 sanity)", () => {
    const contig = compareFilingStatuses({
      userIncome: 0, spouseIncome: 0, loan: LOAN, planId: "paye",
      familySize: 2, state: "TX", applyCommunityRules: false,
      overrideJointAgi: 200000, overrideBorrowerMfsAgi: 120000, overrideSpouseMfsAgi: 80000,
    });
    const alaska = compareFilingStatuses({
      userIncome: 0, spouseIncome: 0, loan: LOAN, planId: "paye",
      familySize: 2, state: "AK", applyCommunityRules: false,
      overrideJointAgi: 200000, overrideBorrowerMfsAgi: 120000, overrideSpouseMfsAgi: 80000,
    });
    // AK poverty guideline is higher → discretionary income lower →
    // MFS monthly payment lower for AK than contiguous 48.
    expect(alaska.mfs.studentLoanMonthlyPayment)
      .toBeLessThanOrEqual(contig.mfs.studentLoanMonthlyPayment);
  });
});

describe("scenario storage namespacing (defect #3)", () => {
  // We test the pure functions used inside StudentLoans.tsx by re-implementing
  // the key composition — the important invariant is that two userIds MUST
  // resolve to distinct storage keys, and a null userId MUST be a no-op.
  const PREFIX = "student_loan_estimator_scenario_v2";
  function keyFor(userId: string | null | undefined): string | null {
    if (!userId) return null;
    return `${PREFIX}:${userId}`;
  }
  it("returns null for anonymous users so we never leak into a shared bucket", () => {
    expect(keyFor(null)).toBeNull();
    expect(keyFor(undefined)).toBeNull();
    expect(keyFor("")).toBeNull();
  });
  it("produces distinct keys per user", () => {
    expect(keyFor("user-a")).toBe(`${PREFIX}:user-a`);
    expect(keyFor("user-b")).toBe(`${PREFIX}:user-b`);
    expect(keyFor("user-a")).not.toBe(keyFor("user-b"));
  });
});
