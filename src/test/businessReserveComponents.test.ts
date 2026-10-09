/**
 * Business Activity per-entry reserve: SE wage-base inputs, deduction
 * classification, state withholding credit, and component-dollar reconciliation.
 * 2026: SS wage base $184,500; Additional Medicare threshold $200,000 (single).
 */
import { describe, it, expect } from "vitest";
import { computeCanonicalEventRecommendation } from "@/lib/canonicalEventRecommendation";

const settings: any = { withholdingMethod: "dynamic_actual", filingStatus: "single" };
const settingsBO: any = { ...settings, businessStateTaxEnabled: true, businessStateTaxRate: 1.5 };

function estimate(o: { w2Gross?: number; w2Fica?: number; seGross?: number; seNet?: number; planned?: number } = {}): any {
  const w2 = o.w2Gross ?? 0;
  return {
    totalIncome: w2 + (o.seGross ?? 0),
    taxableIncome: w2,
    totalTaxLiability: 40_000,
    federalTax: 35_000,
    w2Income: w2,
    w2TaxableIncomeBase: w2,
    seIncome: o.seGross ?? 0,
    grossBusinessIncome: o.seGross ?? 0,
    netBusinessProfit: o.seNet ?? 0,
    seTax: {
      netSEIncome: o.seNet ?? 0,
      w2SsWagesUsed: o.w2Fica ?? w2,
      plannedW2SsWagesUsed: o.planned ?? 0,
    },
  };
}

function rec(est: any, extra: Record<string, unknown> = {}, s: any = settings) {
  return computeCanonicalEventRecommendation({
    estimate: est,
    taxSettings: s,
    incomeType: "1099_schedule_c",
    incomeBucket: "business",
    grossIncome: 10_000,
    creditedWithholding: 0,
    catchUpAmount: 0,
    isFutureOpportunity: true,
    ...extra,
  } as any)!;
}

describe("business reserve — SE wage base inputs", () => {
  it("uses FICA wages, not gross W-2: $190k gross / $180k FICA / $10k SE → $558 Social Security", () => {
    const r = rec(estimate({ w2Gross: 190_000, w2Fica: 180_000 }));
    expect(r.target.seSocialSecurityTax).toBe(558);
    expect(r.target.seMedicareTax).toBe(267.82);
    expect(r.target.seAdditionalMedicareTax).toBe(0);
    expect(r.seWageBase?.limitReached).toBe(false);
  });

  it("prior SE consumes the wage base from NET earnings × 92.35%, not gross", () => {
    // remaining = 184,500 − 180,000 − 4,000×0.9235 = 806 → 806 × 12.4% = 99.94
    const r = rec(estimate({ w2Gross: 180_000, w2Fica: 180_000, seGross: 20_000, seNet: 4_000 }));
    expect(r.target.seSocialSecurityTax).toBe(99.94);
  });

  it("components reconcile exactly to the SE tax total (Additional Medicare applies)", () => {
    const r = rec(estimate({ w2Gross: 195_000, w2Fica: 195_000 }));
    expect(r.target.seSocialSecurityTax).toBe(0);
    expect(r.seWageBase).toEqual({ limitReached: true, projected: false });
    expect(r.target.seAdditionalMedicareTax).toBeGreaterThan(0);
    const sum = Math.round(((r.target.seSocialSecurityTax ?? 0) + (r.target.seMedicareTax ?? 0) + (r.target.seAdditionalMedicareTax ?? 0)) * 100) / 100;
    expect(r.target.selfEmploymentTax).toBe(sum);
  });

  it("labels the limit as projected when only planned W-2 wages reach it", () => {
    const r = rec(estimate({ w2Gross: 190_000, w2Fica: 190_000, planned: 50_000 }));
    expect(r.seWageBase).toEqual({ limitReached: true, projected: true });
  });
});

describe("business reserve — deduction classification", () => {
  const base = estimate({ w2Gross: 100_000, w2Fica: 100_000 });
  it("HSA / SE health insurance do not reduce SE tax but reduce federal tax", () => {
    const none = rec(base);
    const withHsa = rec(base, { federalOnlyDeductions: 2_000 });
    expect(withHsa.target.selfEmploymentTax).toBe(none.target.selfEmploymentTax);
    expect(withHsa.target.federalIncomeTax).toBeLessThan(none.target.federalIncomeTax);
  });

  it("legitimate business deductions still reduce SE tax", () => {
    expect(rec(base, { preTaxDeductions: 2_000 }).target.selfEmploymentTax).toBeLessThan(rec(base).target.selfEmploymentTax);
  });

  it("employee + employer Solo 401(k) do not reduce SE tax", () => {
    const r = rec(base, { retirement401k: 500, employerRetirement401k: 500 });
    expect(r.target.selfEmploymentTax).toBe(rec(base).target.selfEmploymentTax);
    expect(r.target.federalIncomeTax).toBeLessThan(rec(base).target.federalIncomeTax);
  });
});

describe("business reserve — state withholding credit", () => {
  const base = estimate({ w2Gross: 100_000, w2Fica: 100_000 });
  it("credits state withholding against state tax only, capped, no double count", () => {
    const none = rec(base, {}, settingsBO);
    const stateTax = none.target.businessStateTax;
    expect(stateTax).toBe(150);
    const partial = rec(base, { stateWithholding: 100 }, settingsBO);
    expect(partial.creditedStateWithholding).toBe(100);
    expect(partial.recommendedWithholding).toBe(Math.round((none.recommendedWithholding - 100) * 100) / 100);
    // Excess state withholding cannot cancel federal / SE tax.
    const excess = rec(base, { stateWithholding: 5_000 }, settingsBO);
    expect(excess.creditedStateWithholding).toBe(150);
    expect(excess.recommendedWithholding).toBe(Math.round((none.recommendedWithholding - 150) * 100) / 100);
  });

  it("final reserve = tax for this income − credits + catch-up, to the cent", () => {
    const r = rec(base, { stateWithholding: 50, creditedWithholding: 300, catchUpAmount: 125 }, settingsBO);
    const expected = Math.round((r.eventTaxTarget - r.creditedWithholding + r.catchUpApplied) * 100) / 100;
    expect(r.recommendedWithholding).toBe(expected);
    expect(r.creditedWithholding).toBe(350);
  });
});
