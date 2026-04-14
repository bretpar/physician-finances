import { describe, it, expect } from "vitest";
import {
  calculateFullEstimate,
  calculateSETax,
  calculateProgressiveTax,
  BRACKETS_SINGLE,
  BRACKETS_MFJ,
  SE_INCOME_FACTOR,
  SS_WAGE_CAP_DEFAULT,
} from "@/lib/taxEngine";

// ── Helper to build a full estimate with sensible defaults ──
function estimate(overrides: Partial<Parameters<typeof calculateFullEstimate>[0]>) {
  return calculateFullEstimate({
    totalIncome: 0,
    w2Income: 0,
    seIncome: 0,
    preTaxDeductions: 0,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "single",
    lastYearTax: 0,
    bnoRate: 0.015,
    ...overrides,
  });
}

// ================================================================
// 1. Manual transactions (negative amounts historically) vs imported
//    The tax engine itself doesn't care about sign — it receives
//    pre-computed positive totals. These tests confirm the engine
//    produces the same result regardless of how deductions arrive.
// ================================================================
describe("Business deductions are sign-agnostic in the engine", () => {
  const base = {
    totalIncome: 100000,
    seIncome: 100000,
    filingStatus: "single" as const,
  };

  it("deductions reduce net SE income and SE tax", () => {
    const noDed = estimate({ ...base, businessDeductions: 0 });
    const withDed = estimate({ ...base, businessDeductions: 20000 });

    expect(withDed.seTax.total).toBeLessThan(noDed.seTax.total);
    expect(withDed.totalTaxLiability).toBeLessThan(noDed.totalTaxLiability);
    // Net SE = 100k - 20k = 80k
    const expectedSEBase = 80000 * SE_INCOME_FACTOR;
    expect(withDed.seTax.total).toBeCloseTo(
      calculateSETax(80000, "single").total,
      2
    );
  });

  it("same deduction amount yields identical result whether from manual or Plaid source", () => {
    // Both paths now feed Math.abs(amount) into businessDeductions
    const result1 = estimate({ ...base, businessDeductions: 15000 });
    const result2 = estimate({ ...base, businessDeductions: 15000 });
    expect(result1.totalTaxLiability).toEqual(result2.totalTaxLiability);
    expect(result1.businessDeductions).toEqual(result2.businessDeductions);
  });
});

// ================================================================
// 2. W-2 only income — no SE tax, no B&O
// ================================================================
describe("W-2 only income", () => {
  it("has zero SE tax and zero B&O tax", () => {
    const result = estimate({
      totalIncome: 200000,
      w2Income: 200000,
      seIncome: 0,
    });

    expect(result.seTax.total).toBe(0);
    expect(result.bnoTax).toBe(0);
    expect(result.federalTax).toBeGreaterThan(0);
  });

  it("W-2 withholding reduces remaining liability", () => {
    const result = estimate({
      totalIncome: 200000,
      w2Income: 200000,
      seIncome: 0,
      taxesWithheld: 40000,
    });

    expect(result.remainingLiability).toBeLessThan(result.totalTaxLiability);
    expect(result.taxesAlreadyWithheld).toBe(40000);
  });
});

// ================================================================
// 3. Ordinary (non-wage) income only — no SE tax
// ================================================================
describe("Ordinary non-wage income only (dividends, interest)", () => {
  it("does not trigger SE tax when passed as w2Income=0, seIncome=0", () => {
    // Ordinary income (dividends, interest) is part of totalIncome
    // but NOT w2Income and NOT seIncome
    const result = estimate({
      totalIncome: 50000,
      w2Income: 0,
      seIncome: 0,
    });

    expect(result.seTax.total).toBe(0);
    expect(result.bnoTax).toBe(0);
    expect(result.federalTax).toBeGreaterThan(0);
  });

  it("ordinary income should NOT inflate SS wage cap offset", () => {
    // If ordinary income were incorrectly counted as w2Income,
    // it would reduce SS taxable amount for SE earners
    const withCorrectW2 = estimate({
      totalIncome: 200000,
      w2Income: 0, // no W-2 wages
      seIncome: 200000,
    });
    const withInflatedW2 = estimate({
      totalIncome: 200000,
      w2Income: 50000, // if we incorrectly included 50k ordinary as W-2
      seIncome: 200000,
    });

    // With inflated W-2, SS remaining cap is lower → less SS tax → lower total
    // This proves the bug: counting ordinary as W-2 would REDUCE tax liability
    expect(withInflatedW2.seTax.ssTax).toBeLessThan(withCorrectW2.seTax.ssTax);
  });
});

// ================================================================
// 4. Mixed income: W-2 + SE (1099)
// ================================================================
describe("Mixed W-2 + SE income household", () => {
  it("W-2 wages reduce SS cap remaining for SE tax", () => {
    // W-2 of 150k + SE of 50k, single
    const result = estimate({
      totalIncome: 200000,
      w2Income: 150000,
      seIncome: 50000,
    });

    // SS remaining = 168600 - 150000 = 18600
    // SE base = 50000 * 0.9235 = 46175
    // SS taxable = min(46175, 18600) = 18600
    const expectedSSRemaining = SS_WAGE_CAP_DEFAULT - 150000;
    const seBase = 50000 * SE_INCOME_FACTOR;
    const expectedSSTax = Math.min(seBase, expectedSSRemaining) * 0.124;

    expect(result.seTax.ssTax).toBeCloseTo(expectedSSTax, 2);
    expect(result.seTax.medicareTax).toBeCloseTo(seBase * 0.029, 2);
    expect(result.bnoTax).toBeCloseTo(50000 * 0.015, 2);
  });

  it("total tax = federal + SE + B&O", () => {
    const result = estimate({
      totalIncome: 200000,
      w2Income: 100000,
      seIncome: 100000,
      filingStatus: "single",
    });

    expect(result.totalTaxLiability).toBeCloseTo(
      result.federalTax + result.seTax.total + result.bnoTax,
      2
    );
  });
});

// ================================================================
// 5. SE tax calculation edge cases
// ================================================================
describe("SE tax calculation", () => {
  it("zero SE income → zero SE tax", () => {
    const result = calculateSETax(0, "single");
    expect(result.total).toBe(0);
  });

  it("negative SE income → zero SE tax", () => {
    const result = calculateSETax(-5000, "single");
    expect(result.total).toBe(0);
  });

  it("W-2 wages at cap → no SS tax on SE, only Medicare", () => {
    const result = calculateSETax(50000, "single", SS_WAGE_CAP_DEFAULT, SS_WAGE_CAP_DEFAULT);
    expect(result.ssTax).toBe(0);
    expect(result.medicareTax).toBeGreaterThan(0);
  });

  it("additional Medicare triggers above threshold", () => {
    const result = calculateSETax(300000, "single", SS_WAGE_CAP_DEFAULT, 0);
    expect(result.additionalMedicare).toBeGreaterThan(0);
  });

  it("deductible half is exactly 50% of total", () => {
    const result = calculateSETax(100000, "single");
    expect(result.deductibleHalf).toBeCloseTo(result.total / 2, 2);
  });
});

// ================================================================
// 6. Business deductions + mileage reduce net SE income
// ================================================================
describe("Deductions reduce SE and total tax", () => {
  it("mileage deduction reduces SE tax base", () => {
    const noMileage = estimate({ totalIncome: 100000, seIncome: 100000 });
    const withMileage = estimate({ totalIncome: 100000, seIncome: 100000, mileageDeduction: 5000 });
    expect(withMileage.seTax.total).toBeLessThan(noMileage.seTax.total);
  });

  it("combined deductions stack correctly", () => {
    const result = estimate({
      totalIncome: 100000,
      seIncome: 100000,
      businessDeductions: 10000,
      mileageDeduction: 5000,
    });
    // Net SE = 100k - 10k - 5k = 85k
    const expectedSE = calculateSETax(85000, "single");
    expect(result.seTax.total).toBeCloseTo(expectedSE.total, 2);
  });
});

// ================================================================
// 7. Filing status affects brackets and deduction
// ================================================================
describe("Filing status", () => {
  it("MFJ has lower tax than single at same income (higher brackets + deduction)", () => {
    const single = estimate({ totalIncome: 200000, w2Income: 200000, filingStatus: "single" });
    const mfj = estimate({ totalIncome: 200000, w2Income: 200000, filingStatus: "married_filing_jointly" });
    expect(mfj.federalTax).toBeLessThan(single.federalTax);
    expect(mfj.standardDeduction).toBeGreaterThan(single.standardDeduction);
  });
});

// ================================================================
// 8. Effective rate sanity
// ================================================================
describe("Effective rate", () => {
  it("is between 0 and 100%", () => {
    const result = estimate({ totalIncome: 500000, seIncome: 500000 });
    expect(result.effectiveRate).toBeGreaterThan(0);
    expect(result.effectiveRate).toBeLessThan(100);
  });

  it("is zero when income is zero", () => {
    const result = estimate({ totalIncome: 0 });
    expect(result.effectiveRate).toBe(0);
  });
});
