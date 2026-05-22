import { describe, expect, it } from "vitest";
import { sumInvestmentActualTaxSaved, type InvestmentIncomeEntry } from "@/hooks/useInvestmentIncome";

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
  actual_tax_saved: 0,
  notes: "",
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("actual_tax_saved on investment rows increases the saved/paid amount", () => {
  it("sums positive actual_tax_saved across investment entries", () => {
    const total = sumInvestmentActualTaxSaved([
      entry({ actual_tax_saved: 500 }),
      entry({ actual_tax_saved: 1234.56 }),
      entry({ actual_tax_saved: 0 }),
      entry({ actual_tax_saved: null as any }),
    ]);
    expect(total).toBeCloseTo(1734.56, 2);
  });

  it("ignores negative values (clamps to 0)", () => {
    const total = sumInvestmentActualTaxSaved([
      entry({ actual_tax_saved: -50 }),
      entry({ actual_tax_saved: 100 }),
    ]);
    expect(total).toBe(100);
  });

  it("returns 0 when no entries have actual_tax_saved", () => {
    const total = sumInvestmentActualTaxSaved([entry({}), entry({})]);
    expect(total).toBe(0);
  });

  it("adding actual_tax_saved to an entry strictly increases the total", () => {
    const before = sumInvestmentActualTaxSaved([entry({ actual_tax_saved: 200 })]);
    const after = sumInvestmentActualTaxSaved([
      entry({ actual_tax_saved: 200 }),
      entry({ actual_tax_saved: 300 }),
    ]);
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeCloseTo(300, 2);
  });
});
