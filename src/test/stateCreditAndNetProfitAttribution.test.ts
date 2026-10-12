/**
 * Oct 12 audit: (1) excess state withholding must not offset federal savings;
 * (2) net-profit business state tax sees separately recorded business expenses.
 */
import { describe, it, expect } from "vitest";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import {
  computeCanonicalEventRecommendation,
  netProfitBusinessStateBaseForEntry,
} from "@/lib/canonicalEventRecommendation";
import { calculateBusinessStateTax } from "@/lib/taxEngine";

describe("Personal Income — state withholding credit is capped at state tax", () => {
  // $50,000 × 18.74% = $9,370 target ($8,370 federal + $1,000 state).
  const base = {
    grossPaycheckIncome: 50_000,
    eligiblePreTaxDeductions: 0,
    selectedProfileEffectiveTaxRate: 18.74,
    federalIncomeTaxWithheld: 0,
    stateWithholdingIfEnabled: 5_000,
    stateTaxIncludedInTarget: true,
    isW2PaycheckTarget: true,
  };
  it("$1,000 state target / $5,000 state withholding → $8,370 additional savings", () => {
    const r = calculatePaycheckProfileSavings({ ...base, stateTaxTargetForPaycheck: 1_000 });
    expect(r.stateWithholdingCredited).toBe(1_000);
    expect(r.remainingSavingsNeeded).toBe(8_370);
  });
  it("state withholding below the state target is fully credited", () => {
    const r = calculatePaycheckProfileSavings({
      ...base, stateWithholdingIfEnabled: 400, stateTaxTargetForPaycheck: 1_000,
    });
    expect(r.remainingSavingsNeeded).toBe(8_970);
  });
  it("federal income tax withholding still credits federal normally", () => {
    const r = calculatePaycheckProfileSavings({
      ...base, federalIncomeTaxWithheld: 2_000, socialSecurityAndMedicareWithheld: 3_825,
      stateTaxTargetForPaycheck: 1_000,
    });
    expect(r.remainingSavingsNeeded).toBe(6_370);
  });
});

describe("Business Activity — net-profit business state tax", () => {
  const settingsFor = (mode: "gross" | "net_profit"): any => ({
    withholdingMethod: "dynamic_actual", filingStatus: "single",
    businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: mode,
  });
  // Annual estimate EXCLUDES the entry being added: $0 other gross, $1,000 supplies.
  const est = (expenses = 1_000): any => ({
    totalIncome: 0, taxableIncome: 0, totalTaxLiability: 0, federalTax: 0,
    w2Income: 0, w2TaxableIncomeBase: 0, seIncome: 0, grossBusinessIncome: 0,
    netBusinessProfit: -expenses, businessExpenses: expenses,
    businessStateEligibleGross: 0, businessStateEligibleExpenses: expenses,
    seTax: { netSEIncome: 0, w2SsWagesUsed: 0, plannedW2SsWagesUsed: 0 },
  });
  const rec = (e: any, mode: "gross" | "net_profit", extra: Record<string, unknown> = {}) =>
    computeCanonicalEventRecommendation({
      estimate: e, taxSettings: settingsFor(mode), incomeType: "1099_schedule_c",
      incomeBucket: "business", grossIncome: 10_000, creditedWithholding: 0,
      catchUpAmount: 0, isFutureOpportunity: true, ...extra,
    } as any)!;

  it("gross base: $10,000 × 1.5% = $150", () => {
    expect(rec(est(), "gross").target.businessStateTax).toBe(150);
  });
  it("net base with a separately recorded $1,000 expense: $9,000 × 1.5% = $135", () => {
    expect(rec(est(), "net_profit").target.businessStateTax).toBe(135);
  });
  it("$600 federal-only / retirement deductions change neither base", () => {
    const extra = { federalOnlyDeductions: 600, retirement401k: 600, employerRetirement401k: 600 };
    expect(rec(est(), "gross", extra).target.businessStateTax).toBe(150);
    expect(rec(est(), "net_profit", extra).target.businessStateTax).toBe(135);
  });
  it("editing or deleting the expense updates net-profit tax once", () => {
    expect(rec(est(2_000), "net_profit").target.businessStateTax).toBe(120);
    expect(rec(est(0), "net_profit").target.businessStateTax).toBe(150);
  });
  it("reconciles with the annual engine", () => {
    const annual = calculateBusinessStateTax({ inputs: {
      businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: "net_profit",
      eligibleBusinessGross: 10_000, eligibleBusinessExpenses: 1_000,
    } as any }).tax;
    expect(rec(est(), "net_profit").target.businessStateTax).toBeCloseTo(annual, 2);
  });
  it("expenses already absorbed by other income are not attributed again", () => {
    expect(netProfitBusinessStateBaseForEntry(
      { businessStateEligibleGross: 50_000, businessStateEligibleExpenses: 1_000 } as any, 10_000,
    )).toBe(10_000);
    // In-form business deductions plus separate expenses never double-subtract.
    expect(rec(est(), "net_profit", { preTaxDeductions: 500 }).target.businessStateTax).toBe(127.5);
  });
});
