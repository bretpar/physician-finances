/**
 * Consolidated recommendation architecture — nine representative scenarios.
 * Every assertion executes real adapter / engine code.
 */
import { describe, it, expect } from "vitest";
import { computeCanonicalEventRecommendation, buildAllocationFromEstimate } from "@/lib/canonicalEventRecommendation";
import { buildReminderComparison } from "@/lib/incomeRecommendationSurface";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import { calculateBusinessStateTax, calculatePersonalStateTax } from "@/lib/taxEngine";
import {
  isBusinessStateEligibleCompany,
  sumEligiblePlannedBusinessExpenses,
} from "@/hooks/useTaxEstimate";

const dyn: any = { withholdingMethod: "dynamic_actual", filingStatus: "single" };
const bo = (base: "gross" | "net_profit"): any => ({ ...dyn, businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: base });
const est = (o: Record<string, unknown> = {}): any => ({
  seIncome: 0, grossBusinessIncome: 0, netBusinessProfit: 0, w2Income: 0, w2TaxableIncomeBase: 0,
  seTax: { netSEIncome: 0, w2SsWagesUsed: 0, plannedW2SsWagesUsed: 0 }, ...o,
});
const biz = (e: any, s: any, extra: Record<string, unknown> = {}) => computeCanonicalEventRecommendation({
  estimate: e, taxSettings: s, incomeType: "1099_schedule_c", incomeBucket: "business",
  grossIncome: 10_000, creditedWithholding: 0, catchUpAmount: 0, ...extra,
} as any)!;

describe("1. W-2 withholding excludes FICA", () => {
  it("reminder counts federal income tax only, never SS/Medicare", () => {
    const r = buildReminderComparison(
      { totalSuggestedReserve: 2_000, creditedFederalWithholding: 900, creditedStateWithholding: 0 },
      { additionalTaxReserve: 100 },
    );
    expect(r.saved).toBe(1_000);
    expect(r.additionalNeeded).toBe(1_000);
  });
});

describe("2/7. operating expenses counted once; gross vs net-profit base", () => {
  const e = est({ seNetIncomeSigned: -1_000, businessStateEligibleGross: 0, businessStateEligibleExpenses: 1_000 });
  it("net-profit $135, gross $150, SE reflects the expense once", () => {
    expect(biz(e, bo("net_profit")).target.businessStateTax).toBe(135);
    expect(biz(e, bo("gross")).target.businessStateTax).toBe(150);
    expect(biz(e, bo("net_profit")).target.selfEmploymentTax).toBeCloseTo(1_271.66, 2);
  });
});

describe("3. health / HSA / retirement stay federal-only", () => {
  it("do not change SE or business-tax bases", () => {
    const base = biz(est(), bo("net_profit"));
    const withOwner = biz(est(), bo("net_profit"), { retirement401k: 500, employerRetirement401k: 500, federalOnlyDeductions: 600 });
    expect(withOwner.target.selfEmploymentTax).toBe(base.target.selfEmploymentTax);
    expect(withOwner.target.businessStateTax).toBe(base.target.businessStateTax);
    expect(withOwner.netTaxableForEntry).toBe(10_000 - 500 - 600);
  });
});

describe("4. mixed W-2 + 1099 wage-base interaction", () => {
  it("W-2 FICA wages above the SS base leave $0 SE Social Security", () => {
    const r = biz(est({ w2Income: 200_000, seTax: { netSEIncome: 0, w2SsWagesUsed: 190_000, plannedW2SsWagesUsed: 0 } }), dyn);
    expect(r.target.seSocialSecurityTax ?? 0).toBe(0);
    expect(r.target.seMedicareTax).toBeGreaterThan(0);
  });
});

describe("5. personal vs business state withholding applied once", () => {
  it("annual engine credits each category separately and exposes gross", () => {
    const p = calculatePersonalStateTax({ taxableIncome: 0, agi: 0, inputs: {
      stateIncomeTaxEnabled: true, personalStateTaxMode: "annual_estimate", personalStateTaxAnnualEstimate: 1_000, personalStateWithheld: 400 } as any });
    const b = calculateBusinessStateTax({ inputs: {
      businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: "gross", eligibleBusinessGross: 10_000, businessStateWithheld: 50 } as any });
    expect([p.gross, p.tax]).toEqual([1_000, 600]);
    expect([b.gross, b.tax]).toEqual([150, 100]);
  });
  it("event allocation uses GROSS state liability so event withholding isn't deducted twice", () => {
    const annual = est({ businessStateTaxGross: 150, businessStateTax: 0, netBusinessProfit: 10_000, grossBusinessIncome: 10_000, totalTaxLiability: 0 });
    expect(buildAllocationFromEstimate(annual).businessStateTax).toBe(150);
  });
});

describe("6. flat-rate preview / save / reminder agree", () => {
  it("$10,000 × 20%, $500 federal, $5,000 state → $1,500 everywhere", () => {
    const preview = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 10_000, eligiblePreTaxDeductions: 0, selectedProfileEffectiveTaxRate: 20,
      federalIncomeTaxWithheld: 500, stateWithholdingIfEnabled: 5_000, stateTaxTargetForPaycheck: 0, isW2PaycheckTarget: true,
    }).remainingSavingsNeeded;
    const saved = computeCanonicalEventRecommendation({
      estimate: null, taxSettings: { withholdingMethod: "flat_estimate" } as any, incomeType: "w2",
      incomeBucket: "personal", grossIncome: 10_000, creditedWithholding: 500, stateWithholding: 5_000,
      forceFlatRatePct: 20, catchUpAmount: 0, w2FundingMethod: "paycheck_target",
    })!;
    const reminder = buildReminderComparison(saved);
    expect(preview).toBe(1_500);
    expect(saved.recommendedWithholding).toBe(1_500);
    expect(reminder.additionalNeeded).toBe(1_500);
  });
});

describe("8. planned / catch-up attribution by company", () => {
  const companies = [
    { id: "a", name: "Locum A", companyType: "1099_schedule_c", applyBusinessStateTax: true },
    { id: "b", name: "Passive B", companyType: "1099_schedule_c", applyBusinessStateTax: false },
  ];
  it("eligible company's planned expenses survive a $0-income baseline; ineligible ones don't", () => {
    expect(isBusinessStateEligibleCompany(companies[0], {})).toBe(true);
    expect(isBusinessStateEligibleCompany(companies[1], {})).toBe(false);
    expect(sumEligiblePlannedBusinessExpenses({ a: 1_000, b: 700, "name::locum a": 200 }, companies, {})).toBe(1_200);
  });
  it("respects selected-company mode", () => {
    expect(sumEligiblePlannedBusinessExpenses({ a: 1_000 }, companies, { businessStateTaxApplicationMode: "selected", businessStateTaxCompanyIds: [] })).toBe(0);
  });
});

describe("9. preview, save payload and reminder reconcile to the cent", () => {
  it("Business Activity adapter: same canonical result drives all three", () => {
    const e = est({ seNetIncomeSigned: -1_000, businessStateEligibleExpenses: 1_000 });
    const preview = biz(e, bo("net_profit"), { creditedWithholding: 250.55, stateWithholding: 5_000 });
    const save = biz(e, bo("net_profit"), { creditedWithholding: 250.55, stateWithholding: 5_000 });
    const reminder = buildReminderComparison(preview, { actualWithholding: 300 });
    expect(save.recommendedWithholding).toBe(preview.recommendedWithholding);
    expect(preview.creditedStateWithholding).toBe(135);
    expect(reminder.recommended).toBe(preview.totalSuggestedReserve);
    expect(round(reminder.recommended - reminder.creditedWithholding)).toBe(preview.recommendedWithholding);
    expect(reminder.additionalNeeded).toBe(round(preview.recommendedWithholding - 300));
  });
  it("Personal Income adapter: historical events never trigger a reminder", () => {
    expect(buildReminderComparison({ totalSuggestedReserve: 900, creditedFederalWithholding: 0, creditedStateWithholding: 0, isFutureOpportunity: false }).recommended).toBe(0);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
