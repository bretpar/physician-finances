/**
 * Golden scenarios: fixed inputs → expected outputs for the canonical
 * repayment engine. Numbers are derived from the registry formulas and
 * chosen to be reproducible against the FSA Loan Simulator where possible.
 *
 * Tolerance: $1/month on the payment; $12/yr on annual.
 * Any change to a golden number must be justified in a PR description
 * with the FSA Loan Simulator screenshot or Federal Register citation.
 */

import { describe, it, expect } from "vitest";
import { computePlanPayment, amortizedMonthlyPayment } from "@/lib/studentLoan/computePlanPayment";
import type { BorrowerContext, LoanContext } from "@/lib/studentLoan/computePlanPayment";

const T = 1; // dollar tolerance

interface Scenario {
  name: string;
  planId: string;
  loan: LoanContext;
  borrower: BorrowerContext;
  expected: { monthly: number };
}

const SCENARIOS: Scenario[] = [
  {
    name: "Standard 10-Year, $200k @ 6.5%",
    planId: "standard_10",
    loan: { balance: 200_000, interestRatePct: 6.5 },
    borrower: { agi: 250_000, familySize: 1, region: "contiguous_48_dc", filingStatus: "single" },
    expected: { monthly: Math.round(amortizedMonthlyPayment(200_000, 6.5, 120)) },
  },
  {
    name: "IBR new borrower, $200k @ 6.5%, single, AGI $250k, family 1",
    planId: "ibr_new",
    loan: { balance: 200_000, interestRatePct: 6.5 },
    borrower: {
      agi: 250_000, familySize: 1, region: "contiguous_48_dc", filingStatus: "single",
      ibrBorrowerType: "new_2014", isParentPlus: false,
    },
    // Discretionary = 250,000 − 1.5 × 15,960 = 226,060; 10% ÷ 12 = 1,883.83
    // Std-10 cap on $200k @ 6.5% ≈ $2,270; not capped.
    expected: { monthly: Math.round((250_000 - 1.5 * 15_960) * 0.10 / 12) },
  },
  {
    name: "PAYE, MFJ, combined AGI $400k, family 2",
    planId: "paye",
    loan: { balance: 150_000, interestRatePct: 5.0 },
    borrower: {
      agi: 200_000, spouseAgi: 200_000, familySize: 2, region: "contiguous_48_dc",
      filingStatus: "married_filing_jointly", isParentPlus: false,
      firstDisbursementDate: "2020-01-01",
    },
    // AGI combined = 400,000 − 1.5 × (15,960 + 5,680) = 400,000 − 32,460 = 367,540
    // 10% ÷ 12 = 3,062.83 → capped at Std-10 on 150k @ 5% ≈ 1,591 → cap wins
    expected: { monthly: Math.round(amortizedMonthlyPayment(150_000, 5, 120)) },
  },
  {
    name: "RAP, single, AGI $75k, 1 dependent",
    planId: "rap",
    loan: { balance: 100_000, interestRatePct: 6 },
    borrower: {
      agi: 75_000, familySize: 2, region: "contiguous_48_dc",
      filingStatus: "single", dependents: 1, isParentPlus: false,
    },
    // 75k → 7% bracket → 5,250/yr − (1 × 600) = 4,650/yr → 388/mo
    expected: { monthly: Math.round(((75_000 * 0.07) - 600) / 12) },
  },
  {
    name: "RAP, low income $9k, $120 flat annual",
    planId: "rap",
    loan: { balance: 50_000, interestRatePct: 6 },
    borrower: {
      agi: 9_000, familySize: 1, region: "contiguous_48_dc",
      filingStatus: "single", dependents: 0, isParentPlus: false,
    },
    expected: { monthly: 10 }, // 120/12
  },
  {
    name: "ICR, single, AGI $80k, family 1 (100% poverty, 12-yr cap possible)",
    planId: "icr",
    loan: { balance: 60_000, interestRatePct: 7 },
    borrower: {
      agi: 80_000, familySize: 1, region: "contiguous_48_dc", filingStatus: "single",
    },
    // Discretionary = 80,000 − 15,960 = 64,040 → 20%/12 = 1,067
    // 12-yr cap on 60k @ 7% ≈ 637 → cap wins
    expected: { monthly: Math.round(amortizedMonthlyPayment(60_000, 7, 144)) },
  },
  {
    name: "Tiered Standard Plan, $75k balance → 20-year term",
    planId: "tiered_standard",
    loan: { balance: 75_000, interestRatePct: 6 },
    borrower: { agi: 100_000, familySize: 1, region: "contiguous_48_dc", filingStatus: "single" },
    expected: { monthly: Math.round(amortizedMonthlyPayment(75_000, 6, 240)) },
  },
];

describe("golden scenarios", () => {
  for (const s of SCENARIOS) {
    it(s.name, () => {
      const r = computePlanPayment(s.planId, s.loan, s.borrower);
      expect(Math.abs(Math.round(r.monthlyPayment) - s.expected.monthly)).toBeLessThanOrEqual(T);
    });
  }
});
