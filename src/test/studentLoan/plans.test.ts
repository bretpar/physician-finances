import { describe, it, expect } from "vitest";
import {
  computePlanPayment,
  PlanUnavailableError,
  amortizedMonthlyPayment,
} from "@/lib/studentLoan/computePlanPayment";
import type { BorrowerContext, LoanContext } from "@/lib/studentLoan/computePlanPayment";

const baseBorrower: BorrowerContext = {
  agi: 100_000,
  familySize: 2,
  region: "contiguous_48_dc",
  filingStatus: "single",
  dependents: 1,
  spouseAgi: 0,
  ibrBorrowerType: "new_2014",
  isParentPlus: false,
};
const loan: LoanContext = { balance: 200_000, interestRatePct: 6.5 };

describe("fixed-schedule plans", () => {
  it("Standard 10-Year matches direct amortization", () => {
    const r = computePlanPayment("standard_10", loan, baseBorrower);
    expect(r.monthlyPayment).toBeCloseTo(amortizedMonthlyPayment(200_000, 6.5, 120), 1);
    expect(r.breakdown.termMonths).toBe(120);
    expect(r.eligibility).not.toBe("ineligible");
  });

  it("Extended 25 requires balance > $30k", () => {
    expect(() =>
      computePlanPayment("extended_25", { balance: 25_000, interestRatePct: 6 }, baseBorrower),
    ).toThrow(PlanUnavailableError);
  });

  it("Tiered Standard Plan picks term by balance tier", () => {
    expect(computePlanPayment("tiered_standard", { balance: 10_000, interestRatePct: 6 }, baseBorrower).breakdown.termMonths).toBe(120);
    expect(computePlanPayment("tiered_standard", { balance: 30_000, interestRatePct: 6 }, baseBorrower).breakdown.termMonths).toBe(180);
    expect(computePlanPayment("tiered_standard", { balance: 75_000, interestRatePct: 6 }, baseBorrower).breakdown.termMonths).toBe(240);
    expect(computePlanPayment("tiered_standard", { balance: 150_000, interestRatePct: 6 }, baseBorrower).breakdown.termMonths).toBe(300);
  });

  it("Zero balance returns zero payment for standard plans", () => {
    const r = computePlanPayment("standard_10", { balance: 0, interestRatePct: 6 }, baseBorrower);
    expect(r.monthlyPayment).toBe(0);
  });
});

describe("IBR (new borrower, 10%)", () => {
  it("Uses 10% of discretionary (AGI − 150% × poverty)", () => {
    const r = computePlanPayment("ibr_new", loan, { ...baseBorrower, ibrBorrowerType: "new_2014" });
    expect(r.breakdown.percentApplied).toBe(10);
    expect(r.breakdown.povertyMultiplier).toBe(1.5);
    expect(r.monthlyPayment).toBeGreaterThan(0);
  });

  it("Caps at Standard 10-Year", () => {
    const cap = amortizedMonthlyPayment(200_000, 6.5, 120);
    // Massive AGI → uncapped % would exceed the cap
    const r = computePlanPayment("ibr_new", loan, { ...baseBorrower, agi: 5_000_000, ibrBorrowerType: "new_2014" });
    expect(r.monthlyPayment).toBeCloseTo(cap, 0);
    expect(r.breakdown.capApplied).toBe(true);
  });

  it("Zero payment when income at/below protected floor", () => {
    const r = computePlanPayment("ibr_new", loan, { ...baseBorrower, agi: 20_000, familySize: 4, ibrBorrowerType: "new_2014" });
    expect(r.monthlyPayment).toBe(0);
  });

  it("Rejects borrower whose type is 'old'", () => {
    expect(() =>
      computePlanPayment("ibr_new", loan, { ...baseBorrower, ibrBorrowerType: "old" }),
    ).toThrow(PlanUnavailableError);
  });
});

describe("IBR (older borrower, 15%)", () => {
  it("uses 15% rate", () => {
    const r = computePlanPayment("ibr_old", loan, { ...baseBorrower, ibrBorrowerType: "old" });
    expect(r.breakdown.percentApplied).toBe(15);
  });
});

describe("PAYE", () => {
  it("uses 10% × discretionary (150% poverty) with Std-10 cap", () => {
    const r = computePlanPayment("paye", loan, { ...baseBorrower, ibrBorrowerType: null });
    expect(r.breakdown.percentApplied).toBe(10);
    expect(r.breakdown.povertyMultiplier).toBe(1.5);
  });

  it("Parent PLUS rejected", () => {
    expect(() =>
      computePlanPayment("paye", loan, { ...baseBorrower, isParentPlus: true }),
    ).toThrow(PlanUnavailableError);
  });
});

describe("ICR", () => {
  it("uses 100% poverty and 12-year cap", () => {
    const r = computePlanPayment("icr", loan, baseBorrower);
    expect(r.breakdown.povertyMultiplier).toBe(1.0);
    expect(r.breakdown.percentApplied).toBe(20);
    // High AGI hits the 12-year cap
    const cap12 = amortizedMonthlyPayment(200_000, 6.5, 144);
    const bigR = computePlanPayment("icr", loan, { ...baseBorrower, agi: 5_000_000 });
    expect(bigR.monthlyPayment).toBeCloseTo(cap12, 0);
  });
});

describe("RAP (Repayment Assistance Plan)", () => {
  it("uses AGI tiered brackets and $50/dependent deduction with $10 floor", () => {
    const r = computePlanPayment("rap", loan, {
      ...baseBorrower,
      agi: 55_000,
      dependents: 2,
      isParentPlus: false,
    });
    // 55k → 5% bracket → 2,750/yr − (2 × 600 = 1,200) = 1,550/yr → $129/mo
    expect(r.breakdown.percentApplied).toBe(5);
    expect(r.monthlyPayment).toBe(Math.round(((55_000 * 0.05) - 1200) / 12));
    expect(r.breakdown.formula).toMatch(/RAP/);
  });

  it("$10 floor applies to very low computed payment", () => {
    const r = computePlanPayment("rap", loan, {
      ...baseBorrower,
      agi: 15_000,
      dependents: 3,
    });
    expect(r.monthlyPayment).toBeGreaterThanOrEqual(10);
  });

  it("$120 flat annual applies at AGI ≤ $10k", () => {
    const r = computePlanPayment("rap", loan, { ...baseBorrower, agi: 5_000, dependents: 0 });
    expect(r.monthlyPayment).toBe(10); // 120/12
  });

  it("MFJ combines AGI; MFS uses filer only", () => {
    const mfj = computePlanPayment("rap", loan, {
      ...baseBorrower, filingStatus: "married_filing_jointly", agi: 60_000, spouseAgi: 60_000, dependents: 0,
    });
    const mfs = computePlanPayment("rap", loan, {
      ...baseBorrower, filingStatus: "married_filing_separately", agi: 60_000, spouseAgi: 60_000, dependents: 0,
    });
    expect(mfj.breakdown.incomeUsed).toBe(120_000);
    expect(mfs.breakdown.incomeUsed).toBe(60_000);
    expect(mfj.monthlyPayment).toBeGreaterThan(mfs.monthlyPayment);
  });

  it("Parent PLUS rejected", () => {
    expect(() =>
      computePlanPayment("rap", loan, { ...baseBorrower, isParentPlus: true }),
    ).toThrow(PlanUnavailableError);
  });
});

describe("Closed/historical plans throw PlanUnavailableError", () => {
  it("SAVE cannot be estimated", () => {
    expect(() => computePlanPayment("save", loan, baseBorrower)).toThrow(PlanUnavailableError);
  });
  it("REPAYE cannot be estimated", () => {
    expect(() => computePlanPayment("repaye", loan, baseBorrower)).toThrow(PlanUnavailableError);
  });
  it("Unknown plan id throws", () => {
    expect(() => computePlanPayment("bogus", loan, baseBorrower)).toThrow(PlanUnavailableError);
  });
});

describe("Additional monthly payment adds on top", () => {
  it("adds the extra to base", () => {
    const base = computePlanPayment("standard_10", loan, baseBorrower).monthlyPayment;
    const extra = computePlanPayment(
      "standard_10",
      { ...loan, additionalMonthlyPayment: 200 },
      baseBorrower,
    ).monthlyPayment;
    expect(extra - base).toBeCloseTo(200, 1);
  });

  it("clamps negative extra to zero", () => {
    const base = computePlanPayment("standard_10", loan, baseBorrower).monthlyPayment;
    const neg = computePlanPayment(
      "standard_10",
      { ...loan, additionalMonthlyPayment: -500 },
      baseBorrower,
    ).monthlyPayment;
    expect(neg).toBe(base);
  });
});

describe("amortization edge cases", () => {
  it("zero interest divides evenly", () => {
    expect(amortizedMonthlyPayment(12_000, 0, 120)).toBe(100);
  });
  it("zero principal returns zero", () => {
    expect(amortizedMonthlyPayment(0, 6, 120)).toBe(0);
  });
});
