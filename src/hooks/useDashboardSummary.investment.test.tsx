import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import type { InvestmentIncomeEntry } from "@/hooks/useInvestmentIncome";
import type { TaxRates } from "@/hooks/useTaxSettings";

const rates = { stateIncomeTaxEnabled: false } as TaxRates;

const investmentEntry = (taxableAmount: number): InvestmentIncomeEntry => ({
  id: crypto.randomUUID(),
  user_id: "user-1",
  organization_id: "org-1",
  entry_date: "2026-04-01",
  investment_income_type: taxableAmount >= 0 ? "short_term_sale" : "long_term_sale",
  asset_name_or_ticker: "AAPL",
  sale_proceeds: 20000,
  cost_basis: 12000,
  taxable_amount: taxableAmount,
  tax_recommendation: 0,
  notes: "",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
});

describe("useDashboardSummary investment integration", () => {
  it("adds investment taxable amount to personal and total income without requiring sale proceeds", () => {
    const { result } = renderHook(() =>
      useDashboardSummary([], rates, [], [], [investmentEntry(8000), investmentEntry(-500)]),
    );

    expect(result.current.personalIncome).toBe(7500);
    expect(result.current.totalIncome).toBe(7500);
  });
});
