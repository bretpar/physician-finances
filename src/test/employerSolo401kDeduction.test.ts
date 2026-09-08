/**
 * 1099 / Schedule C employer (profit-sharing) Solo 401(k) contributions:
 * - reduce the FEDERAL taxable base of the per-entry recommendation
 * - never reduce the self-employment tax base
 * - affect Net Received only when the company cash-flow setting is ON
 */
import { describe, it, expect } from "vitest";
import { computeCanonicalEventRecommendation } from "@/lib/canonicalEventRecommendation";
import { computeEstimatedNet } from "@/lib/estimatedNet";

const estimate: any = {
  totalIncome: 120_000,
  taxableIncome: 100_000,
  totalTaxLiability: 30_000,
  federalTax: 20_000,
  selfEmploymentTax: 10_000,
  seIncome: 120_000,
  w2Income: 0,
  businessIncome: 120_000,
};

const settings: any = { withholdingMethod: "dynamic_actual", filingStatus: "single" };

function rec(employerRetirement: number, employeeRetirement = 0) {
  return computeCanonicalEventRecommendation({
    estimate,
    taxSettings: settings,
    incomeType: "1099_schedule_c",
    incomeBucket: "business",
    grossIncome: 10_080,
    retirement401k: employeeRetirement,
    employerRetirement401k: employerRetirement,
    preTaxDeductions: 0,
    creditedWithholding: 0,
    catchUpAmount: 0,
    isFutureOpportunity: true,
  })!;
}

describe("1099 employer Solo 401(k) — tax treatment", () => {
  it("reduces the recommendation when an employer contribution is added", () => {
    const none = rec(0);
    const withEmployer = rec(1_000);
    expect(withEmployer.eventTaxTarget).toBeLessThan(none.eventTaxTarget);
  });

  it("does not change the self-employment tax portion", () => {
    expect(rec(1_000).target.selfEmploymentTax).toBeCloseTo(
      rec(0).target.selfEmploymentTax,
      2,
    );
  });

  it("reduces only the federal portion", () => {
    expect(rec(1_000).target.federalIncomeTax).toBeLessThan(rec(0).target.federalIncomeTax);
  });

  it("recommendation is reduced regardless of the paycheck-reduction setting", () => {
    // Tax treatment does not read the cash-flow setting at all.
    const reduced = rec(1_000).eventTaxTarget;
    expect(reduced).toBeLessThan(rec(0).eventTaxTarget);
  });
});

describe("1099 employer Solo 401(k) — cash flow", () => {
  const base = { gross: 10_080, federal: 0, ss: 0, medicare: 0, state: 0, retirement: 0, employerRetirement: 1_000 };

  it("Net Received stays at gross when the setting is OFF", () => {
    expect(computeEstimatedNet({ ...base } as any)).toBe(10_080);
  });

  it("Net Received drops by the employer contribution when the setting is ON", () => {
    expect(
      computeEstimatedNet({ ...base, employerRetirementReducesPaycheck: true } as any),
    ).toBe(9_080);
  });
});

describe("annual estimate input", () => {
  it("sums employee + employer contributions into businessRetirement for non-W-2 entries", () => {
    const entries = [
      { income_type: "1099_schedule_c", retirement_401k: 500, employer_retirement_contribution: 1_000 },
      { income_type: "w2", retirement_401k: 200, employer_retirement_contribution: 900 },
    ];
    const businessRetirement = entries.reduce((s, e: any) => {
      const isW2 = e.income_type === "w2" || e.income_type === "scorp_w2";
      return s + Number(e.retirement_401k || 0) + (isW2 ? 0 : Number(e.employer_retirement_contribution || 0));
    }, 0);
    expect(businessRetirement).toBe(1_700);
  });
});
