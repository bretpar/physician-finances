/**
 * Oct 12 final verification: flat-rate Personal Income ignores state
 * withholding; edit/replacement keeps separately recorded business expenses.
 */
import { describe, it, expect } from "vitest";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import { computeCanonicalEventRecommendation } from "@/lib/canonicalEventRecommendation";
import { calculateBusinessStateTax, calculateFullEstimate } from "@/lib/taxEngine";

describe("flat-rate Personal Income: $10,000 × 20%, $500 federal, $5,000 state", () => {
  const preview = () => calculatePaycheckProfileSavings({
    grossPaycheckIncome: 10_000, eligiblePreTaxDeductions: 0, selectedProfileEffectiveTaxRate: 20,
    federalIncomeTaxWithheld: 500, stateWithholdingIfEnabled: 5_000, stateTaxIncludedInTarget: true,
    stateTaxTargetForPaycheck: 0, isW2PaycheckTarget: true,
  });
  const saved = () => computeCanonicalEventRecommendation({
    estimate: null, taxSettings: { withholdingMethod: "flat_estimate" } as any,
    incomeType: "w2", incomeBucket: "personal", grossIncome: 10_000,
    creditedWithholding: 500, stateWithholding: 5_000, forceFlatRatePct: 20,
    catchUpAmount: 0, w2FundingMethod: "paycheck_target",
  })!;
  it("preview recommends $1,500", () => {
    expect(preview().stateWithholdingCredited).toBe(0);
    expect(preview().remainingSavingsNeeded).toBe(1_500);
  });
  it("saved / reminder recommendation matches at $1,500", () => {
    const r = saved();
    expect(r.eventTaxTarget).toBe(2_000);
    expect(r.creditedStateWithholding).toBe(0);
    expect(r.recommendedWithholding).toBe(1_500);
  });
  it("reopening (same inputs) is stable", () => {
    expect(preview().remainingSavingsNeeded).toBe(saved().recommendedWithholding);
  });
  it("dynamic mode still caps state credit at the state component", () => {
    const r = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 50_000, eligiblePreTaxDeductions: 0, selectedProfileEffectiveTaxRate: 18.74,
      federalIncomeTaxWithheld: 0, stateWithholdingIfEnabled: 5_000, stateTaxTargetForPaycheck: 1_000,
      isW2PaycheckTarget: true,
    });
    expect(r.remainingSavingsNeeded).toBe(8_370);
  });
});

describe("edit/replacement: $10,000 1099 with a separately recorded $1,000 expense", () => {
  const settings = (base: "gross" | "net_profit"): any => ({
    withholdingMethod: "dynamic_actual", filingStatus: "single",
    businessStateTaxEnabled: true, businessStateTaxRate: 1.5, businessStateTaxBase: base,
  });
  // Estimate with the edited income excluded: only the expense remains.
  const est = (expense = 1_000): any => ({
    seIncome: 0, grossBusinessIncome: 0, netBusinessProfit: -expense, businessExpenses: expense,
    seNetIncomeSigned: -expense, businessStateEligibleGross: 0, businessStateEligibleExpenses: expense,
    seTax: { netSEIncome: 0, w2SsWagesUsed: 0, plannedW2SsWagesUsed: 0 },
  });
  const rec = (e: any, base: "gross" | "net_profit", extra: Record<string, unknown> = {}) =>
    computeCanonicalEventRecommendation({
      estimate: e, taxSettings: settings(base), incomeType: "1099_schedule_c", incomeBucket: "business",
      grossIncome: 10_000, creditedWithholding: 0, catchUpAmount: 0, ...extra,
    } as any)!;
  const annual = calculateFullEstimate({
    totalIncome: 10_000, w2Income: 0, seIncome: 10_000, grossBusinessIncome: 10_000,
    businessDeductions: 1_000, seBusinessDeductions: 1_000, filingStatus: "single",
  } as any);

  it("net-profit business tax $135 (base $9,000); gross stays $150", () => {
    expect(rec(est(), "net_profit").target.businessStateTax).toBe(135);
    expect(rec(est(), "gross").target.businessStateTax).toBe(150);
    expect(calculateBusinessStateTax({ inputs: { businessStateTaxEnabled: true, businessStateTaxRate: 1.5,
      businessStateTaxBase: "net_profit", eligibleBusinessGross: 10_000, eligibleBusinessExpenses: 1_000 } as any }).tax).toBe(135);
  });
  it("entry SE tax reflects the expense once and matches annual $1,271.66", () => {
    expect(annual.seTax.total).toBeCloseTo(1_271.66, 2);
    expect(rec(est(), "net_profit").target.selfEmploymentTax).toBeCloseTo(1_271.66, 2);
  });
  it("owner HSA / health / retirement don't change SE or business-tax bases", () => {
    const r = rec(est(), "net_profit", { retirement401k: 300, federalOnlyDeductions: 300 });
    expect(r.target.businessStateTax).toBe(135);
    expect(r.target.selfEmploymentTax).toBeCloseTo(1_271.66, 2);
  });
  it("editing / deleting the expense updates once, no duplication", () => {
    expect(rec(est(2_000), "net_profit").target.businessStateTax).toBe(120);
    expect(rec(est(0), "net_profit").target.businessStateTax).toBe(150);
    expect(rec(est(0), "net_profit").target.selfEmploymentTax).toBeCloseTo(1_412.96, 2);
  });
  it("expenses absorbed by other SE income aren't attributed again", () => {
    const e = { ...est(), seNetIncomeSigned: 40_000, seIncome: 41_000 };
    expect(rec(e, "net_profit").netTaxableForEntry).toBe(10_000);
  });
});
