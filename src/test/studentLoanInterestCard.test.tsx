import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeStudentLoanInterestDeduction } from "@/lib/studentLoanInterestDeduction";
import { isCategoryStillVisible } from "@/lib/taxSavingsCategories";
import AgiReconciliationPanel from "@/components/tax-breakdown/AgiReconciliationPanel";
import type { TaxBreakdownResult } from "@/hooks/useTaxBreakdown";

const flags = { showMileage: true, showHomeOffice: true, showRetirement: true, showHsa: true };

describe("Tax Savings accordion navigation", () => {
  it("keeps Student Loan Interest expanded instead of reverting to Retirement", () => {
    expect(isCategoryStillVisible("student-loan-interest", flags)).toBe(true);
    expect(isCategoryStillVisible("student-loan-interest", {
      showMileage: false, showHomeOffice: false, showRetirement: true, showHsa: false,
    })).toBe(true);
  });

  it("still collapses gated categories that become unavailable", () => {
    expect(isCategoryStillVisible("mileage", { ...flags, showMileage: false })).toBe(false);
    expect(isCategoryStillVisible("retirement", flags)).toBe(true);
  });

  it("treats coming-soon / always-available categories as valid targets", () => {
    for (const v of ["mortgage-interest", "salt", "charitable", "other-adjustments"]) {
      expect(isCategoryStillVisible(v, flags)).toBe(true);
    }
  });
});

describe("Student Loan Interest deduction shared logic", () => {
  it("returns $0 for married filing separately", () => {
    const r = computeStudentLoanInterestDeduction({
      interestPaid: 5000, magi: 90_000, filingStatus: "married_filing_separately",
    });
    expect(r.deduction).toBe(0);
    expect(r.ineligibleFilingStatus).toBe(true);
  });

  it("matches the engine value for a single filer mid phase-out", () => {
    const r = computeStudentLoanInterestDeduction({
      interestPaid: 3000, magi: 92_500, filingStatus: "single",
    });
    // capped at 2500, halfway through 85k–100k => 50%
    expect(r.cappedInterest).toBe(2500);
    expect(r.deduction).toBeCloseTo(1250, 2);
  });

  it("still enforces the $2,500 cap below the phase-out", () => {
    const r = computeStudentLoanInterestDeduction({
      interestPaid: 9000, magi: 50_000, filingStatus: "single",
    });
    expect(r.deduction).toBe(2500);
  });
});

function makeData(studentLoanInterestDeduction: number): TaxBreakdownResult {
  return {
    mode: "forecast",
    totalReturnIncomeBeforeAdjustments: 200_000,
    totalBusinessProfit: 0,
    totalW2Income: 200_000,
    w2PreTaxDeductions: 0,
    w2TaxableIncomeBase: 200_000,
    totalOtherIncome: 0,
    totalShortTermGains: 0,
    totalLongTermGains: 0,
    preTaxDeductions: 1_000,
    deductionSourceBreakdown: "",
    retirement401k: 10_000,
    plannedRetirement: 0,
    healthInsuranceDeduction: 2_000,
    actualHealthInsuranceDeduction: 2_000,
    projectedHealthInsuranceDeduction: 0,
    seDeductibleHalf: 500,
    studentLoanInterestDeduction,
    seTax: { netSEIncome: 0, seBase: 0, total: 0 },
    agi: 200_000 - 1_000 - 10_000 - 2_000 - 500 - studentLoanInterestDeduction,
  } as unknown as TaxBreakdownResult;
}

describe("AGI details: Student Loan Interest row", () => {
  it("appears exactly once when a deduction is allowed", () => {
    render(<AgiReconciliationPanel data={makeData(1_250)} />);
    expect(screen.getAllByText("Student Loan Interest")).toHaveLength(1);
  });

  it("is omitted when the deduction is $0", () => {
    render(<AgiReconciliationPanel data={makeData(0)} />);
    expect(screen.queryByText("Student Loan Interest")).toBeNull();
  });

  it("reconciles total return income to AGI through the displayed adjustments", () => {
    const d = makeData(1_250);
    const adjustments =
      d.preTaxDeductions + d.retirement401k + d.healthInsuranceDeduction +
      d.studentLoanInterestDeduction + d.seDeductibleHalf;
    expect(d.totalReturnIncomeBeforeAdjustments - adjustments).toBeCloseTo(d.agi, 2);
  });
});
