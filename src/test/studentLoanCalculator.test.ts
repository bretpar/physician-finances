import { describe, it, expect } from "vitest";
import {
  aggregateLoans,
  estimateRepayment,
  type BorrowerInput,
  type StudentLoanInput,
} from "@/lib/studentLoan/calculator";
import {
  amortizedMonthlyPayment,
  monthsToPayoff,
  federalPovertyLine,
} from "@/lib/studentLoan/repaymentPlans";

const borrower = (overrides: Partial<BorrowerInput> = {}): BorrowerInput => ({
  filingStatus: "single",
  familySize: 1,
  annualIncome: 200_000,
  ...overrides,
});

const loan = (overrides: Partial<StudentLoanInput> = {}): StudentLoanInput => ({
  balance: 200_000,
  interestRatePct: 6,
  ...overrides,
});

describe("amortizedMonthlyPayment", () => {
  it("computes the standard 10-year payment for a typical physician loan", () => {
    // $200k @ 6% over 120 months ≈ $2,220.41
    const m = amortizedMonthlyPayment(200_000, 6, 120);
    expect(m).toBeGreaterThan(2_200);
    expect(m).toBeLessThan(2_240);
  });

  it("handles a zero interest rate as simple division", () => {
    expect(amortizedMonthlyPayment(120_000, 0, 120)).toBe(1_000);
  });

  it("returns 0 for a zero balance", () => {
    expect(amortizedMonthlyPayment(0, 6, 120)).toBe(0);
  });

  it("clamps negative principal to zero", () => {
    expect(amortizedMonthlyPayment(-50_000, 6, 120)).toBe(0);
  });

  it("treats a negative rate as zero (no negative amortization)", () => {
    expect(amortizedMonthlyPayment(120_000, -5, 120)).toBe(1_000);
  });

  it("floors term months at 1 to avoid divide-by-zero", () => {
    // With N=1, payment ≈ full balance + one month of interest.
    const m = amortizedMonthlyPayment(1_000, 0, 0);
    expect(m).toBe(1_000);
  });
});

describe("monthsToPayoff", () => {
  it("returns 0 for a zero balance", () => {
    expect(monthsToPayoff(0, 6, 500)).toBe(0);
  });

  it("returns null when the payment is zero", () => {
    expect(monthsToPayoff(100_000, 6, 0)).toBeNull();
  });

  it("returns null when payment does not cover monthly interest", () => {
    // $200k @ 6% → $1,000/mo interest. $500 payment can't cover it.
    expect(monthsToPayoff(200_000, 6, 500)).toBeNull();
    // Exactly matching interest also never pays off.
    expect(monthsToPayoff(200_000, 6, 1_000)).toBeNull();
  });

  it("returns the ceiling of months at a valid payment", () => {
    // Zero interest: 120k / 1k = 120 months.
    expect(monthsToPayoff(120_000, 0, 1_000)).toBe(120);
  });

  it("matches the amortization term when paying the amortized amount", () => {
    const m = amortizedMonthlyPayment(200_000, 6, 120);
    const n = monthsToPayoff(200_000, 6, m);
    // Allow one month of rounding slack.
    expect(n).not.toBeNull();
    expect(Math.abs((n as number) - 120)).toBeLessThanOrEqual(1);
  });
});

describe("federalPovertyLine", () => {
  it("returns the base guideline for family size 1", () => {
    expect(federalPovertyLine(1)).toBe(15_060);
  });

  it("adds per-person amounts for larger families", () => {
    expect(federalPovertyLine(4)).toBe(15_060 + 5_380 * 3);
  });

  it("clamps invalid family sizes to at least 1", () => {
    expect(federalPovertyLine(0)).toBe(15_060);
    expect(federalPovertyLine(-3)).toBe(15_060);
    // Non-integer input floors to 1 (per implementation).
    expect(federalPovertyLine(0.4)).toBe(15_060);
  });
});

describe("aggregateLoans", () => {
  it("returns a zero-balance stub when no loans are provided", () => {
    const agg = aggregateLoans([]);
    expect(agg.balance).toBe(0);
    expect(agg.interestRatePct).toBe(0);
  });

  it("returns the single loan unchanged", () => {
    const only = loan({ balance: 100_000, interestRatePct: 5 });
    expect(aggregateLoans([only])).toEqual(only);
  });

  it("filters out zero-balance rows before aggregating", () => {
    const agg = aggregateLoans([loan({ balance: 0, interestRatePct: 10 }), loan({ balance: 50_000, interestRatePct: 4 })]);
    expect(agg.balance).toBe(50_000);
    expect(agg.interestRatePct).toBe(4);
  });

  it("computes a balance-weighted average interest rate", () => {
    const agg = aggregateLoans([
      loan({ balance: 100_000, interestRatePct: 4 }),
      loan({ balance: 100_000, interestRatePct: 8 }),
    ]);
    expect(agg.balance).toBe(200_000);
    expect(agg.interestRatePct).toBeCloseTo(6, 5);
  });

  it("sums current and additional monthly payments across loans", () => {
    const agg = aggregateLoans([
      loan({ balance: 100_000, interestRatePct: 5, currentMonthlyPayment: 400, additionalMonthlyPayment: 100 }),
      loan({ balance: 100_000, interestRatePct: 5, currentMonthlyPayment: 600, additionalMonthlyPayment: 50 }),
    ]);
    expect(agg.currentMonthlyPayment).toBe(1_000);
    expect(agg.additionalMonthlyPayment).toBe(150);
  });
});

describe("estimateRepayment — standard fixed plans", () => {
  it("produces the amortized payment for Standard 10-Year", () => {
    const r = estimateRepayment(loan(), borrower(), "standard_10");
    expect(r.plan.id).toBe("standard_10");
    expect(r.estimatedMonthlyPayment).toBeGreaterThan(2_200);
    expect(r.estimatedMonthlyPayment).toBeLessThan(2_240);
    expect(r.estimatedAnnualPayment).toBeCloseTo(r.estimatedMonthlyPayment * 12, 2);
    expect(r.coversMonthlyInterest).toBe(true);
    expect(r.estimatedPayoffMonths).not.toBeNull();
  });

  it("lowers the payment substantially on Extended 25-Year", () => {
    const std = estimateRepayment(loan(), borrower(), "standard_10").estimatedMonthlyPayment;
    const ext = estimateRepayment(loan(), borrower(), "extended_25").estimatedMonthlyPayment;
    expect(ext).toBeLessThan(std);
    expect(ext).toBeGreaterThan(0);
  });

  it("adds any additional monthly payment on top of the base payment", () => {
    const base = estimateRepayment(loan(), borrower(), "standard_10").estimatedMonthlyPayment;
    const withExtra = estimateRepayment(
      loan({ additionalMonthlyPayment: 500 }),
      borrower(),
      "standard_10",
    ).estimatedMonthlyPayment;
    expect(withExtra).toBeCloseTo(base + 500, 2);
  });

  it("falls back to a standard 10-year estimate for the 'other' plan", () => {
    const std = estimateRepayment(loan(), borrower(), "standard_10").estimatedMonthlyPayment;
    const other = estimateRepayment(loan(), borrower(), "other").estimatedMonthlyPayment;
    expect(other).toBeCloseTo(std, 2);
  });
});

describe("estimateRepayment — zero and invalid inputs", () => {
  it("returns zeroed results for a zero-balance loan", () => {
    const r = estimateRepayment(loan({ balance: 0 }), borrower(), "standard_10");
    expect(r.estimatedMonthlyPayment).toBe(0);
    expect(r.monthlyInterest).toBe(0);
    expect(r.annualInterest).toBe(0);
    expect(r.estimatedPayoffMonths).toBe(0);
    // A $0 payment on $0 balance trivially "covers" $0 interest.
    expect(r.coversMonthlyInterest).toBe(true);
  });

  it("handles a zero interest rate without divide-by-zero", () => {
    const r = estimateRepayment(loan({ balance: 120_000, interestRatePct: 0 }), borrower(), "standard_10");
    expect(r.monthlyInterest).toBe(0);
    expect(r.estimatedMonthlyPayment).toBeCloseTo(1_000, 2);
  });

  it("clamps negative balances and negative rates to zero", () => {
    const r = estimateRepayment(loan({ balance: -50_000, interestRatePct: -3 }), borrower(), "standard_10");
    expect(r.estimatedMonthlyPayment).toBe(0);
    expect(r.monthlyInterest).toBe(0);
  });

  it("ignores negative additional payments (treats as zero)", () => {
    const base = estimateRepayment(loan(), borrower(), "standard_10").estimatedMonthlyPayment;
    const neg = estimateRepayment(
      loan({ additionalMonthlyPayment: -500 }),
      borrower(),
      "standard_10",
    ).estimatedMonthlyPayment;
    expect(neg).toBeCloseTo(base, 2);
  });

  it("flags when the payment does not cover monthly interest (extended + tiny balance vs high rate is contrived; use IDR $0)", () => {
    // Force the scenario: SAVE with income below the discretionary floor + no
    // additional payment → estimatedMonthly = 0 while interest > 0.
    const r = estimateRepayment(loan({ balance: 200_000, interestRatePct: 6 }), borrower({ annualIncome: 0 }), "save");
    expect(r.estimatedMonthlyPayment).toBe(0);
    expect(r.coversMonthlyInterest).toBe(false);
    expect(r.estimatedPayoffMonths).toBeNull();
    expect(r.notes.join(" ")).toMatch(/does not fully cover monthly interest/i);
  });
});

describe("estimateRepayment — income-driven plans", () => {
  it("computes PAYE as 10% of discretionary income (AGI - 1.5x FPL) when uncapped", () => {
    // Use a small balance so the 10-year cap doesn't kick in.
    const r = estimateRepayment(
      loan({ balance: 20_000, interestRatePct: 6 }),
      borrower({ annualIncome: 100_000, familySize: 1 }),
      "paye",
    );
    const expectedDiscretionary = 100_000 - federalPovertyLine(1) * 1.5;
    const expectedMonthly = (expectedDiscretionary * 0.10) / 12;
    expect(r.discretionaryIncome).toBeCloseTo(expectedDiscretionary, 2);
    expect(r.estimatedMonthlyPayment).toBeCloseTo(expectedMonthly, 1);
  });

  it("caps PAYE at the Standard 10-Year amount for high earners", () => {
    const cap = amortizedMonthlyPayment(200_000, 6, 120);
    const r = estimateRepayment(loan(), borrower({ annualIncome: 500_000 }), "paye");
    expect(r.estimatedMonthlyPayment).toBeCloseTo(cap, 1);
    expect(r.notes.some((n) => /capped/i.test(n))).toBe(true);
  });

  it("yields a $0 PAYE payment when income is at or below the discretionary floor", () => {
    const r = estimateRepayment(loan(), borrower({ annualIncome: 10_000, familySize: 1 }), "paye");
    expect(r.discretionaryIncome).toBe(0);
    expect(r.estimatedMonthlyPayment).toBe(0);
    expect(r.notes.some((n) => /IDR payment is \$0/i.test(n))).toBe(true);
  });

  it("uses SAVE's 225% poverty multiplier, not PAYE/IBR's 150%", () => {
    // With family size 1 and $60k income, discretionary floor differs by plan.
    const income = 60_000;
    const paye = estimateRepayment(loan({ balance: 20_000 }), borrower({ annualIncome: income }), "paye");
    const save = estimateRepayment(loan({ balance: 20_000 }), borrower({ annualIncome: income }), "save");
    // Same 10% rate, but SAVE excludes more income → lower payment.
    expect(save.estimatedMonthlyPayment).toBeLessThan(paye.estimatedMonthlyPayment);
    expect(save.discretionaryIncome).toBeLessThan(paye.discretionaryIncome ?? Infinity);
  });

  it("applies ICR's lesser-of rule (does not exceed the 12-year adjusted schedule)", () => {
    const twelveYear = amortizedMonthlyPayment(200_000, 6, 144);
    const r = estimateRepayment(loan(), borrower({ annualIncome: 400_000 }), "icr");
    // ICR uses 20% of discretionary; for a high earner that would blow past
    // the 12-year cap, so estimate must be ≤ that cap.
    expect(r.estimatedMonthlyPayment).toBeLessThanOrEqual(twelveYear + 0.01);
  });

  it("adds the additional monthly payment to IDR base payments", () => {
    const base = estimateRepayment(loan({ balance: 20_000 }), borrower({ annualIncome: 100_000 }), "paye")
      .estimatedMonthlyPayment;
    const withExtra = estimateRepayment(
      loan({ balance: 20_000, additionalMonthlyPayment: 250 }),
      borrower({ annualIncome: 100_000 }),
      "paye",
    ).estimatedMonthlyPayment;
    expect(withExtra).toBeCloseTo(base + 250, 1);
  });
});

describe("estimateRepayment — graduated plan", () => {
  it("starts below the standard payment but at least covers monthly interest", () => {
    const std = estimateRepayment(loan(), borrower(), "standard_10").estimatedMonthlyPayment;
    const grad = estimateRepayment(loan(), borrower(), "graduated_10");
    expect(grad.estimatedMonthlyPayment).toBeLessThan(std);
    expect(grad.estimatedMonthlyPayment).toBeGreaterThanOrEqual(grad.monthlyInterest - 0.01);
    expect(grad.notes.join(" ")).toMatch(/step up/i);
  });
});
