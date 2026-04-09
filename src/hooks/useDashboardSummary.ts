import { useMemo } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { TaxRates } from "@/hooks/useTaxSettings";
import type { IncomeEntry } from "@/hooks/useIncome";
import { calculateFullEstimate, type TaxEstimate } from "@/lib/taxEngine";

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

    const entries = incomeEntries || [];
    const totalIncome = entries.reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const w2Income = entries.filter((e) => e.income_type === "W2").reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const seIncome = entries.filter((e) => e.income_type !== "W2").reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const w2Withheld = entries.reduce((s, e) => s + Number(e.taxes_withheld), 0);
    const preTaxDeductions = entries.reduce((s, e) => s + Number(e.pre_tax_deductions), 0);
    const retirement401k = entries.reduce((s, e) => s + Number(e.retirement_401k), 0);

    const expenseRows = (transactions || []).filter((t) => t.amount < 0);
    const totalExpenses = Math.abs(expenseRows.reduce((s, t) => s + t.amount, 0));

    const est = calculateFullEstimate({
      totalIncome, w2Income, seIncome, preTaxDeductions, retirement401k,
      businessDeductions: totalExpenses, mileageDeduction: 0,
      taxesWithheld: w2Withheld, filingStatus: rates.filingStatus,
      lastYearTax: rates.lastYearTax, bnoRate: rates.bnoRate / 100,
    });

    return {
      totalIncome, totalExpenses,
      netProfit: totalIncome - totalExpenses,
      w2Income, w2Withheld,
      selfEmploymentIncome: seIncome,
      selfEmploymentProfit: seIncome - totalExpenses,
      estimatedTax: est.federalTax,
      seTax: est.seTax.total,
      bnoTax: est.bnoTax,
      totalTaxLiability: est.totalTaxLiability,
      remainingLiability: est.remainingLiability,
      quarterlyEstimate: est.quarterlyEstimate,
      totalPreTaxDeductions: preTaxDeductions,
      total401k: retirement401k,
    };
  }, [transactions, rates, incomeEntries]);
}
