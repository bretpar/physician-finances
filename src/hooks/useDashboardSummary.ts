import { useMemo } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { TaxRates } from "@/hooks/useTaxSettings";

export interface DashboardSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  w2Income: number;
  w2Withheld: number;
  selfEmploymentIncome: number;
  selfEmploymentProfit: number;
  estimatedTax: number;
  seTax: number;
  bnoTax: number;
  totalTaxLiability: number;
  remainingLiability: number;
  quarterlyEstimate: number;
}

export function useDashboardSummary(
  transactions: DbTransaction[] | undefined,
  rates: TaxRates | undefined
): DashboardSummary {
  return useMemo(() => {
    const empty: DashboardSummary = {
      totalIncome: 0, totalExpenses: 0, netProfit: 0,
      w2Income: 0, w2Withheld: 0, selfEmploymentIncome: 0, selfEmploymentProfit: 0,
      estimatedTax: 0, seTax: 0, bnoTax: 0,
      totalTaxLiability: 0, remainingLiability: 0, quarterlyEstimate: 0,
    };
    if (!transactions || !rates) return empty;

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const monthly = transactions.filter((t) => {
      const d = new Date(t.transaction_date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });

    const incomeRows = monthly.filter((t) => t.amount > 0);
    const expenseRows = monthly.filter((t) => t.amount < 0);

    const totalIncome = incomeRows.reduce((s, t) => s + t.amount, 0);
    const totalExpenses = Math.abs(expenseRows.reduce((s, t) => s + t.amount, 0));

    // W-2 specifics — category contains "W-2" or "W2"
    const isW2 = (t: DbTransaction) =>
      t.category.toLowerCase().includes("w-2") || t.category.toLowerCase().includes("w2") ||
      t.company_type.toUpperCase() === "W2";
    const w2Income = incomeRows.filter(isW2).reduce((s, t) => s + t.amount, 0);
    // W-2 withholding stored in the notes field as "withheld:XXXX" or via expected_withholding
    // For simplicity, use a convention: W-2 withholding = federal_rate% of W-2 income as default
    // TODO: pull from income_forecasts expected_withholding
    const w2Withheld = w2Income * (rates.federalRate / 100);

    const selfEmploymentIncome = incomeRows.filter((t) => !isW2(t)).reduce((s, t) => s + t.amount, 0);
    const netProfit = totalIncome - totalExpenses;
    const selfEmploymentProfit = selfEmploymentIncome - totalExpenses;

    const federalRate = rates.federalRate / 100;
    const seRate = 0.153;
    const bnoRate = rates.bnoRate / 100;

    const estimatedTax = netProfit * federalRate;
    const seTax = Math.max(0, selfEmploymentProfit) * seRate * 0.9235;
    const bnoTax = selfEmploymentIncome * bnoRate;

    const totalTaxLiability = estimatedTax + seTax + bnoTax;
    const remainingLiability = Math.max(0, totalTaxLiability - w2Withheld);
    const quarterlyEstimate = remainingLiability / 4;

    return {
      totalIncome, totalExpenses, netProfit,
      w2Income, w2Withheld, selfEmploymentIncome, selfEmploymentProfit,
      estimatedTax, seTax, bnoTax,
      totalTaxLiability, remainingLiability, quarterlyEstimate,
    };
  }, [transactions, rates]);
}
