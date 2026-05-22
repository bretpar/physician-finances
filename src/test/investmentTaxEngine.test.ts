/**
 * Investment tax-engine safeguards.
 *
 * Enforces the invariants from the investment-income audit:
 *  1. Sales contribute taxable gain (proceeds - costBasis), never raw proceeds.
 *  2. "Net received" never reaches the tax engine (no such field exists on
 *     investment_income_entries; this test pins that contract).
 *  3. Taxable gain is counted exactly once.
 *  4. Long-term sales and qualified dividends are taxed at LTCG rates.
 *  5. Short-term sales and non-qualified dividends are taxed as ordinary income.
 *  6. Recommended set-aside = taxable gain × correct rate (LTCG vs ordinary slice).
 *  7. Cost basis does not act as a deduction outside the gain calc.
 */

import { describe, expect, it } from "vitest";
import {
  aggregateInvestmentTaxBuckets,
  calculateInvestmentTaxableAmount,
  type InvestmentIncomeEntry,
} from "@/hooks/useInvestmentIncome";
import { calculateInvestmentTaxRecommendation } from "@/lib/investmentTaxRecommendation";

const entry = (overrides: Partial<InvestmentIncomeEntry>): InvestmentIncomeEntry => ({
  id: "e",
  user_id: "u",
  organization_id: "o",
  entry_date: "2026-04-15",
  investment_income_type: "long_term_sale",
  asset_name_or_ticker: "TEST",
  sale_proceeds: 0,
  cost_basis: 0,
  taxable_amount: 0,
  tax_recommendation: 0,
  notes: "",
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("Investment tax-engine invariants", () => {
  it("1. taxable gain = proceeds - costBasis for sales (the user's worked example)", () => {
    const proceeds = 83681.0;
    const costBasis = 47934.23;
    const expectedGain = 35746.77;

    const lt = calculateInvestmentTaxableAmount({
      type: "long_term_sale",
      saleProceeds: proceeds,
      costBasis,
    });
    const st = calculateInvestmentTaxableAmount({
      type: "short_term_sale",
      saleProceeds: proceeds,
      costBasis,
    });
    expect(lt).toBeCloseTo(expectedGain, 2);
    expect(st).toBeCloseTo(expectedGain, 2);
    // Never the raw proceeds.
    expect(lt).not.toBe(proceeds);
    expect(st).not.toBe(proceeds);
  });

  it("1b. user override wins over proceeds - costBasis", () => {
    expect(
      calculateInvestmentTaxableAmount({
        type: "long_term_sale",
        saleProceeds: 83681,
        costBasis: 47934.23,
        taxableAmountOverride: 30000,
      }),
    ).toBe(30000);
  });

  it("2. investment_income_entries contract has no 'net_received' field", () => {
    // Pin the schema: cash-flow net is not part of the tax surface here.
    const e: InvestmentIncomeEntry = entry({});
    expect(Object.prototype.hasOwnProperty.call(e, "net_received")).toBe(false);
  });

  it("3+7. aggregate buckets only sum taxable_amount — proceeds & cost_basis never leak in", () => {
    const buckets = aggregateInvestmentTaxBuckets([
      entry({
        investment_income_type: "long_term_sale",
        sale_proceeds: 83681,
        cost_basis: 47934.23,
        taxable_amount: 35746.77,
      }),
    ]);
    expect(buckets.longTermSales).toBeCloseTo(35746.77, 2);
    expect(buckets.longTermCapitalGain).toBeCloseTo(35746.77, 2);
    expect(buckets.totalTaxableIncome).toBeCloseTo(35746.77, 2);
    // Critically: total never picks up proceeds (83681) or basis (47934.23).
    expect(buckets.totalTaxableIncome).not.toBe(83681);
    expect(buckets.ordinaryInvestmentIncome).toBe(0);
  });

  it("4. long-term sale → LTCG bracket rate (15% for the worked example)", () => {
    const rec = calculateInvestmentTaxRecommendation({
      type: "long_term_sale",
      taxableAmount: 35746.77,
      filingStatus: "married_filing_jointly",
      // Baseline already above the 0% LTCG threshold and the slice stays under
      // the 20% threshold, so the entire slice is taxed at 15%.
      projectedOrdinaryTaxableIncome: 200000,
    });
    expect(rec.taxMethod).toBe("long_term_capital_gains");
    expect(rec.effectiveRate).toBeCloseTo(0.15, 4);
    expect(rec.estimatedTax).toBeCloseTo(35746.77 * 0.15, 1); // ~5362.02
  });

  it("4b. qualified dividend follows LTCG logic", () => {
    const rec = calculateInvestmentTaxRecommendation({
      type: "dividend",
      taxableAmount: 1000,
      isQualifiedDividend: true,
      filingStatus: "single",
      projectedOrdinaryTaxableIncome: 100000,
    });
    expect(rec.taxMethod).toBe("qualified_dividend");
    expect(rec.effectiveRate).toBeCloseTo(0.15, 4);
  });

  it("5. short-term sale uses ordinary slice math (not LTCG)", () => {
    const rec = calculateInvestmentTaxRecommendation({
      type: "short_term_sale",
      taxableAmount: 10000,
      filingStatus: "single",
      projectedOrdinaryTaxableIncome: 60000, // sits in 22% ordinary bracket
    });
    expect(rec.taxMethod).toBe("short_term_ordinary");
    // Far above any LTCG rate (15%); proves we're NOT using LTCG brackets.
    expect(rec.effectiveRate).toBeGreaterThan(0.2);
  });

  it("5b. non-qualified dividend follows ordinary logic", () => {
    const rec = calculateInvestmentTaxRecommendation({
      type: "dividend",
      taxableAmount: 2000,
      isQualifiedDividend: false,
      filingStatus: "single",
      projectedOrdinaryTaxableIncome: 60000,
    });
    expect(rec.taxMethod).toBe("ordinary_dividend");
    expect(rec.effectiveRate).toBeGreaterThan(0.2);
  });

  it("6. recommended set-aside = taxable gain × correct LTCG rate (5362.02 ± rounding)", () => {
    const rec = calculateInvestmentTaxRecommendation({
      type: "long_term_sale",
      taxableAmount: 35746.77,
      filingStatus: "married_filing_jointly",
      projectedOrdinaryTaxableIncome: 200000,
    });
    expect(rec.estimatedTax).toBeCloseTo(5362.02, 1);
  });

  it("3. each entry's taxable gain counted exactly once across buckets", () => {
    const buckets = aggregateInvestmentTaxBuckets([
      entry({ investment_income_type: "long_term_sale", taxable_amount: 35746.77 }),
      entry({ investment_income_type: "short_term_sale", taxable_amount: 1000 }),
      entry({ investment_income_type: "dividend", taxable_amount: 500, is_qualified_dividend: true }),
    ]);
    // Sum across exclusive bucket routes equals total taxable income.
    expect(buckets.ordinaryInvestmentIncome + buckets.longTermCapitalGain).toBeCloseTo(
      buckets.totalTaxableIncome,
      2,
    );
  });
});
