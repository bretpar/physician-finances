/**
 * VA pre-tax payroll health-insurance premiums (Section 125).
 *
 * The per-company designation (`healthcare_pretax_payroll`) records that a
 * W-2 company's `healthcare_deduction` is a pre-tax payroll premium. It must:
 *  • reduce W-2 taxable wages exactly once (actual + planned),
 *  • never double-count when the premium is already inside an aggregate
 *    pre-tax total,
 *  • never become a self-employed health-insurance deduction or QBI adjustment,
 *  • leave non-designated companies and non-W-2 companies unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  resolveHealthcarePretaxPayroll,
  HEALTHCARE_PRETAX_PAYROLL_KEY,
} from "@/lib/filingTypes";
import { getProjectedTotals } from "@/hooks/useProjectedIncome";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";

const VA = { id: "va-1", companyType: "w2", advancedFieldVisibility: { healthcare_deduction: true, [HEALTHCARE_PRETAX_PAYROLL_KEY]: true } };

describe("healthcare pre-tax payroll designation", () => {
  it("defaults OFF and never assumes all W-2 premiums are pre-tax", () => {
    expect(resolveHealthcarePretaxPayroll("w2", {})).toBe(false);
    expect(resolveHealthcarePretaxPayroll("w2", { healthcare_deduction: true })).toBe(false);
  });

  it("applies only to W-2 / S-Corp-W-2 companies with the healthcare field enabled", () => {
    const on = { healthcare_deduction: true, [HEALTHCARE_PRETAX_PAYROLL_KEY]: true };
    expect(resolveHealthcarePretaxPayroll("w2", on)).toBe(true);
    expect(resolveHealthcarePretaxPayroll("scorp_w2", on)).toBe(true);
    expect(resolveHealthcarePretaxPayroll("1099_schedule_c", on)).toBe(false);
    expect(resolveHealthcarePretaxPayroll("k1_partnership", on)).toBe(false);
    // Field disabled → designation neutralized
    expect(resolveHealthcarePretaxPayroll("w2", { healthcare_deduction: false, [HEALTHCARE_PRETAX_PAYROLL_KEY]: true })).toBe(false);
  });
});

const paycheck = (over: Record<string, unknown>) => ({
  streamId: "s1",
  matchStatus: "active",
  grossAmount: 10_000,
  taxesWithheld: 1_000,
  federalWithholding: 800,
  stateWithholding: 200,
  ssWithholding: 0,
  medicareWithholding: 0,
  retirement401k: 0,
  employerRetirementContribution: 0,
  preTaxDeductions: 50,
  healthcareDeduction: 200,
  hsaContribution: 0,
  netAmount: 8_550,
  hasDetailedBreakdown: true,
  streamCompanyType: "w2",
  ...over,
}) as any;

const stream = { id: "s1", company_type: "w2", source_id: "va-1", state_withholding: 200 } as any;

describe("planned W-2 premiums", () => {
  it("adds the designated premium to pre-tax wages exactly once (detailed breakdown)", () => {
    const t = getProjectedTotals([paycheck({})], [stream], [VA]);
    expect(t.preTaxDeductions).toBe(250); // 50 other + 200 premium
    expect(t.healthInsuranceDeduction).toBe(0); // never SE health insurance
    expect(t.w2Income).toBe(10_000);
  });

  it("does not double-count when the premium is already inside the aggregate pre-tax total", () => {
    // Aggregate mode: preTaxDeductions 250 already includes the 200 premium.
    const t = getProjectedTotals(
      [paycheck({ hasDetailedBreakdown: false, preTaxDeductions: 250 })],
      [stream],
      [VA],
    );
    expect(t.preTaxDeductions).toBe(250);
  });

  it("leaves non-designated companies unchanged", () => {
    const other = { id: "other-1", companyType: "w2", advancedFieldVisibility: { healthcare_deduction: true } };
    const t = getProjectedTotals(
      [paycheck({})],
      [{ ...stream, source_id: "other-1" }],
      [other],
    );
    expect(t.preTaxDeductions).toBe(50);
    expect(t.healthInsuranceDeduction).toBe(0);
  });

  it("keeps SE-stream premiums as self-employed health insurance, not W-2 pre-tax", () => {
    const t = getProjectedTotals(
      [paycheck({ streamCompanyType: "1099_schedule_c" })],
      [{ ...stream, company_type: "1099_schedule_c", source_id: "biz-1" }],
      [{ id: "biz-1", companyType: "1099_schedule_c", advancedFieldVisibility: { healthcare_deduction: true, [HEALTHCARE_PRETAX_PAYROLL_KEY]: true } }],
    );
    expect(t.preTaxDeductions).toBe(50);
    expect(t.healthInsuranceDeduction).toBe(200);
  });
});

function engineInput(overrides: Partial<UnifiedTaxInput> = {}): UnifiedTaxInput {
  return {
    businessIncome: 0, seEligibleBusinessIncome: 0, businessW2: 0,
    businessFederalWithheld: 0, businessStateWithheld: 0, businessPreTax: 0,
    businessRetirement: 0, ownerHealthcare: 0, businessStateEligibleGross: 0,
    businessStateEligibleExpenses: 0, businessStateEligibleMileage: 0,
    businessStateEligibleOwnerAdjustments: 0, personalIncome: 0, personalW2: 0,
    personalNonW2Income: 0, personalFederalWithheld: 0, personalStateWithheld: 0,
    personalPreTax: 0, personalRetirement: 0, netStockGain: 0, businessExpenses: 0,
    mileageDeduction: 0, annualizedRetirement: 0, txActualWithholding: 0,
    actualEstimatedPaymentsMade: 0, taxSavingsSetAside: 0, remainingPayPeriods: 12,
    projectedW2Income: 0, projectedSEIncome: 0, projectedOtherIncome: 0,
    projectedFederalWithheld: 0, projectedStateWithheld: 0, projectedPreTax: 0,
    projectedRetirement: 0, projectedHealthInsuranceDeduction: 0,
    filingStatus: "single", lastYearTax: 0, ssWageCap: 176_100,
    includeProjectedIncome: false, businessNonW2HsaAboveLine: 0,
    personalNonW2HsaAboveLine: 0, ...overrides,
  };
}

describe("engine treatment of actual VA premiums", () => {
  it("reduces W-2 taxable wages once and never becomes self-employed health insurance", () => {
    const noPremium = computeUnifiedTaxEstimate(engineInput({ personalIncome: 100_000, personalW2: 100_000 }));
    // $2,400/yr VA premium routed through personalPreTax by useTaxEstimate.
    const withPremium = computeUnifiedTaxEstimate(engineInput({
      personalIncome: 100_000, personalW2: 100_000, personalPreTax: 2_400,
    }));
    expect(withPremium.debug.w2TaxableIncomeBase).toBe(97_600);
    expect(noPremium.debug.w2TaxableIncomeBase - withPremium.debug.w2TaxableIncomeBase).toBe(2_400);
    expect(withPremium.debug.healthInsuranceDeduction).toBe(0); // not SEHI
    expect(noPremium.estimate.agi - withPremium.estimate.agi).toBeCloseTo(2_400, 2);
  });
});
