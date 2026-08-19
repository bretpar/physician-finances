import { describe, expect, it } from "vitest";
import {
  ORDINARY_BRACKETS,
  STANDARD_DEDUCTION,
  QBI_THRESHOLDS,
  LTCG_BRACKETS,
  getTaxYearConfig,
  calcSETax,
} from "@/lib/taxBrackets";
import { computeQuickEstimate } from "@/lib/quickEstimate";
import {
  getCatchUpForAge,
  getCatchUpForDateOfBirth,
  ageAttainedInTaxYear,
  computeEmployeeContributionRoom,
  getRetirementLimits,
} from "@/lib/retirementContributionRoom";
import { isSETaxableEntity } from "@/lib/k1TaxTreatment";

describe("Head of household support", () => {
  it("has HOH brackets, standard deduction, LTCG and QBI data for the active year", () => {
    const cfg = getTaxYearConfig();
    expect(cfg.ordinaryBrackets.head_of_household.length).toBeGreaterThan(0);
    expect(cfg.standardDeduction.head_of_household).toBeGreaterThan(0);
    expect(cfg.ltcgBrackets.head_of_household.length).toBeGreaterThan(0);
    expect(cfg.qbiThresholds.head_of_household.threshold).toBeGreaterThan(0);
    expect(ORDINARY_BRACKETS.head_of_household).toBeDefined();
    expect(LTCG_BRACKETS.head_of_household).toBeDefined();
    expect(QBI_THRESHOLDS.head_of_household).toBeDefined();
  });

  it("uses the 2026 HOH standard deduction of $24,150", () => {
    const cfg = getTaxYearConfig(2026);
    expect(cfg.standardDeduction.head_of_household).toBe(24_150);
  });

  it("places HOH brackets between single and MFJ", () => {
    const hoh = STANDARD_DEDUCTION.head_of_household;
    expect(hoh).toBeGreaterThan(STANDARD_DEDUCTION.single);
    expect(hoh).toBeLessThan(STANDARD_DEDUCTION.married_filing_jointly);
  });

  it("quick estimate produces a lower federal tax for HOH than single at equal income", () => {
    const base = {
      incomeKind: "w2_only" as const,
      state: "WA",
      w2Income: 150_000,
      businessIncome: 0,
      investmentIncome: 0,
      deductionStrategy: "standard" as const,
      itemizedAmount: 0,
      retirement401k: 0,
      hsa: 0,
      otherPretax: 0,
    };
    const single = computeQuickEstimate({ ...base, filingStatus: "single" });
    const hoh = computeQuickEstimate({ ...base, filingStatus: "head_of_household" });
    expect(hoh.federalTax).toBeLessThan(single.federalTax);
  });
});

describe("Mixed W-2 + business SE tax (Quick Estimate)", () => {
  it("does not charge Social Security SE tax when W-2 wages already exceed the wage base", () => {
    const cfg = getTaxYearConfig();
    const r = computeQuickEstimate({
      incomeKind: "w2_plus_business",
      filingStatus: "single",
      state: "WA",
      w2Income: cfg.ssWageBase + 50_000,
      businessIncome: 50_000,
      investmentIncome: 0,
      deductionStrategy: "standard",
      itemizedAmount: 0,
      retirement401k: 0,
      hsa: 0,
      otherPretax: 0,
    });
    // Medicare-only: 50,000 * 0.9235 * 2.9%
    const expected = 50_000 * 0.9235 * 0.029;
    expect(r.seTax).toBeCloseTo(expected, 2);
  });

  it("matches the canonical SE helper for partial wage-base consumption", () => {
    const cfg = getTaxYearConfig();
    const w2 = cfg.ssWageBase - 20_000;
    const r = computeQuickEstimate({
      incomeKind: "w2_plus_business",
      filingStatus: "married_filing_jointly",
      state: "WA",
      w2Income: w2,
      businessIncome: 60_000,
      investmentIncome: 0,
      deductionStrategy: "standard",
      itemizedAmount: 0,
      retirement401k: 0,
      hsa: 0,
      otherPretax: 0,
    });
    expect(r.seTax).toBeCloseTo(calcSETax(60_000, w2).total, 2);
  });

  it("business-only income is fully SE-taxed up to the wage base", () => {
    const r = computeQuickEstimate({
      incomeKind: "business_only",
      filingStatus: "single",
      state: "WA",
      w2Income: 0,
      businessIncome: 120_000,
      investmentIncome: 0,
      deductionStrategy: "standard",
      itemizedAmount: 0,
      retirement401k: 0,
      hsa: 0,
      otherPretax: 0,
    });
    expect(r.seTax).toBeCloseTo(calcSETax(120_000, 0).total, 2);
  });
});

describe("K-1 SE-tax eligibility from k1TaxTreatment", () => {
  it("active partnership and guaranteed payments are SE-taxable", () => {
    expect(isSETaxableEntity({ filingType: "k1_partnership", k1TaxTreatment: "active_partnership" })).toBe(true);
    expect(isSETaxableEntity({ filingType: "k1_partnership", k1TaxTreatment: "guaranteed_payments" })).toBe(true);
  });

  it("passive K-1 and S-corp distributions are not SE-taxable", () => {
    expect(isSETaxableEntity({ filingType: "k1_partnership", k1TaxTreatment: "passive" })).toBe(false);
    expect(isSETaxableEntity({ filingType: "k1_partnership", k1TaxTreatment: "scorp_distribution" })).toBe(false);
  });

  it("treatment overrides the legacy include-SE-tax flag", () => {
    expect(
      isSETaxableEntity({
        filingType: "k1_partnership",
        k1TaxTreatment: "passive",
        includeSETaxInRecommendation: true,
      }),
    ).toBe(false);
    expect(
      isSETaxableEntity({
        filingType: "k1_partnership",
        k1TaxTreatment: "active_partnership",
        includeSETaxInRecommendation: false,
      }),
    ).toBe(true);
  });

  it("falls back to the legacy flag when no treatment is set", () => {
    expect(isSETaxableEntity({ filingType: "k1_partnership", k1TaxTreatment: null })).toBe(true);
    expect(
      isSETaxableEntity({ filingType: "k1_partnership", includeSETaxInRecommendation: false }),
    ).toBe(false);
  });

  it("1099 stays SE-taxable and W-2 never is", () => {
    expect(isSETaxableEntity({ filingType: "1099_schedule_c" })).toBe(true);
    expect(isSETaxableEntity({ filingType: "w2" })).toBe(false);
  });
});

describe("2026 retirement catch-up limits", () => {
  it("uses the 2026 statutory figures", () => {
    const l = getRetirementLimits(2026);
    expect(l.employeeDeferral).toBe(24_500);
    expect(l.catchUp50).toBe(8_000);
    expect(l.catchUp60to63).toBe(11_250);
  });

  it("resolves catch-up by age attained in the tax year", () => {
    expect(getCatchUpForAge(2026, 49)).toBe(0);
    expect(getCatchUpForAge(2026, 50)).toBe(8_000);
    expect(getCatchUpForAge(2026, 59)).toBe(8_000);
    expect(getCatchUpForAge(2026, 60)).toBe(11_250);
    expect(getCatchUpForAge(2026, 63)).toBe(11_250);
    expect(getCatchUpForAge(2026, 64)).toBe(8_000);
    expect(getCatchUpForAge(2026, null)).toBe(0);
  });

  it("derives age and catch-up from a date of birth", () => {
    expect(ageAttainedInTaxYear("1966-11-02", 2026)).toBe(60);
    expect(getCatchUpForDateOfBirth(2026, "1966-11-02")).toBe(11_250);
    expect(getCatchUpForDateOfBirth(2026, "1980-01-01")).toBe(0);
    expect(getCatchUpForDateOfBirth(2026, null)).toBe(0);
  });

  it("raises the employee deferral limit with the age-based catch-up", () => {
    const under50 = computeEmployeeContributionRoom({
      taxYear: 2026,
      employeeContributions: [10_000],
      dateOfBirth: "1990-05-05",
    });
    expect(under50.employeeDeferralLimit).toBe(24_500);
    expect(under50.catchUpAllowed).toBe(0);

    const fifty = computeEmployeeContributionRoom({
      taxYear: 2026,
      employeeContributions: [10_000],
      dateOfBirth: "1974-03-03",
    });
    expect(fifty.employeeDeferralLimit).toBe(32_500);
    expect(fifty.catchUpAllowed).toBe(8_000);

    const sixtyOne = computeEmployeeContributionRoom({
      taxYear: 2026,
      employeeContributions: [10_000],
      dateOfBirth: "1965-07-07",
    });
    expect(sixtyOne.employeeDeferralLimit).toBe(35_750);
    expect(sixtyOne.employeeRemainingRoom).toBe(25_750);
  });
});
