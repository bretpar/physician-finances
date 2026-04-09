import { useMemo } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { TaxRates } from "@/hooks/useTaxSettings";
import type { IncomeEntry } from "@/hooks/useIncome";

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
  totalPreTaxDeductions: number;
  total401k: number;
}

export function useDashboardSummary(
  transactions: DbTransaction[] | undefined,
  rates: TaxRates | undefined,
  incomeEntries?: IncomeEntry[]
): DashboardSummary {
  return useMemo(() => {
    const empty: DashboardSummary = {
      totalIncome: 0, totalExpenses: 0, netProfit: 0,
      w2Income: 0, w2Withheld: 0, selfEmploymentIncome: 0, selfEmploymentProfit: 0,
      estimatedTax: 0, seTax: 0, bnoTax: 0,
      totalTaxLiability: 0, remainingLiability: 0, quarterlyEstimate: 0,
      totalPreTaxDeductions: 0, total401k: 0,
    };
    if (!rates) return empty;

    // --- Income from income_entries ---
    const entries = incomeEntries || [];
    const w2Entries = entries.filter((e) => e.income_type === "W2");
    const nonW2Entries = entries.filter((e) => e.income_type !== "W2");

    const totalIncome = entries.reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const w2Income = w2Entries.reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const w2Withheld = entries.reduce((s, e) => s + Number(e.taxes_withheld), 0);
    const selfEmploymentIncome = nonW2Entries.reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const totalPreTaxDeductions = entries.reduce((s, e) => s + Number(e.pre_tax_deductions), 0);
    const total401k = entries.reduce((s, e) => s + Number(e.retirement_401k), 0);

    // --- Expenses from transactions ---
    const expenseRows = (transactions || []).filter((t) => t.amount < 0);
    const totalExpenses = Math.abs(expenseRows.reduce((s, t) => s + t.amount, 0));

    const netProfit = totalIncome - totalExpenses;
    const selfEmploymentProfit = selfEmploymentIncome - totalExpenses;

    const taxableIncome = totalIncome - totalPreTaxDeductions - total401k;
    const federalRate = rates.federalRate / 100;
    const seRate = 0.153;
    const bnoRate = rates.bnoRate / 100;

    const estimatedTax = Math.max(0, taxableIncome) * federalRate;
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
      totalPreTaxDeductions, total401k,
    };
  }, [transactions, rates, incomeEntries]);
}
