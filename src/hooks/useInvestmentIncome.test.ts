import { describe, expect, it } from "vitest";
import {
  aggregateInvestmentTaxBuckets,
  calculateInvestmentTaxableAmount,
  type InvestmentIncomeEntry,
} from "@/hooks/useInvestmentIncome";

const baseEntry: InvestmentIncomeEntry = {
  id: "entry-1",
  user_id: "user-1",
  organization_id: "org-1",
  entry_date: "2026-04-15",
  investment_income_type: "short_term_sale",
  asset_name_or_ticker: "AAPL",
  sale_proceeds: 0,
  cost_basis: 0,
  taxable_amount: 0,
  tax_recommendation: 0,
  notes: "",
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
};

const investmentEntry = (overrides: Partial<InvestmentIncomeEntry>): InvestmentIncomeEntry => ({
  ...baseEntry,
  ...overrides,
});

describe("investment income helpers", () => {
  it("defaults sale taxable amount to proceeds minus basis and allows overrides", () => {
    expect(calculateInvestmentTaxableAmount({ type: "short_term_sale", saleProceeds: 20000, costBasis: 12000 })).toBe(8000);
    expect(calculateInvestmentTaxableAmount({ type: "long_term_sale", saleProceeds: 5000, costBasis: 8000 })).toBe(-3000);
    expect(calculateInvestmentTaxableAmount({ type: "short_term_sale", saleProceeds: 20000, costBasis: 12000, taxableAmountOverride: 7500 })).toBe(7500);
  });

  it("routes dividends by qualified flag and splits ordinary vs LTCG buckets", () => {
    expect(calculateInvestmentTaxableAmount({ type: "dividend", saleProceeds: 0, costBasis: 0, taxableAmountOverride: 450 })).toBe(450);

    const buckets = aggregateInvestmentTaxBuckets([
      investmentEntry({ investment_income_type: "short_term_sale", taxable_amount: 1000 }),
      investmentEntry({ investment_income_type: "long_term_sale", taxable_amount: -300 }),
      investmentEntry({ investment_income_type: "dividend", taxable_amount: 250, is_qualified_dividend: true }),
      investmentEntry({ investment_income_type: "dividend", taxable_amount: 100, is_qualified_dividend: false }),
    ]);

    expect(buckets.shortTermSales).toBe(1000);
    expect(buckets.longTermSales).toBe(-300);
    expect(buckets.dividends).toBe(350);
    expect(buckets.qualifiedDividends).toBe(250);
    expect(buckets.nonQualifiedDividends).toBe(100);
    expect(buckets.totalTaxableIncome).toBe(1050);
    expect(buckets.netSalesForCurrentTaxEngine).toBe(700);
    // Short-term gain + non-qualified dividend → ordinary bucket.
    expect(buckets.ordinaryInvestmentIncome).toBe(1100);
    // Qualified dividend → LTCG bucket; long-term loss does not offset cross-bucket here.
    expect(buckets.longTermCapitalGain).toBe(250);
  });
});
