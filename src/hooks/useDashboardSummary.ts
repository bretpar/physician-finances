import { useMemo } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { TaxRates } from "@/hooks/useTaxSettings";
import type { IncomeEntry } from "@/hooks/useIncome";
import type { PersonalIncomeEntry } from "@/hooks/usePersonalIncome";

export interface DashboardSummary {
  businessIncome: number;
  businessExpenses: number;
  businessNetIncome: number;
  personalIncome: number;
  projectedIncome: number;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  w2Income: number;
  w2Withheld: number;
  totalWithheld: number;
}

export function useDashboardSummary(
  transactions: DbTransaction[] | undefined,
  rates: TaxRates | undefined,
  incomeEntries?: IncomeEntry[],
  personalEntries?: PersonalIncomeEntry[]
): DashboardSummary {
  return useMemo(() => {
    const empty: DashboardSummary = {
      businessIncome: 0, businessExpenses: 0, businessNetIncome: 0,
      personalIncome: 0, projectedIncome: 0,
      totalIncome: 0, totalExpenses: 0, netProfit: 0,
      w2Income: 0, w2Withheld: 0, totalWithheld: 0,
    };
    if (!rates) return empty;

    // Business income and expenses from transactions
    const txs = transactions || [];
    const businessIncome = txs
      .filter((t) => t.transaction_type === "income" && !t.is_deleted)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const businessExpenses = txs
      .filter((t) => (t.transaction_type === "expense" || !t.transaction_type) && !t.is_deleted && t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    const businessNetIncome = businessIncome - businessExpenses;

    // Personal income from personal income entries
    const personal = personalEntries || [];
    const personalIncome = personal.reduce((s, e) => {
      const amt = Number(e.gross_amount);
      return s + (e.income_type === "loss" ? -Math.abs(amt) : amt);
    }, 0);
    const w2Income = personal
      .filter((e) => e.income_type === "w2_user" || e.income_type === "w2_partner")
      .reduce((s, e) => s + Number(e.gross_amount), 0);
    const w2Withheld = personal
      .reduce((s, e) => s + Number(e.federal_withholding || 0), 0);

    // Business withholding from transactions
    const txWithheld = txs
      .filter((t) => t.transaction_type === "income" && !t.is_deleted)
      .reduce((s, t) => s + Number(t.actual_withholding || 0), 0);

    // Legacy business income entries withholding
    const legacyWithheld = (incomeEntries || [])
      .reduce((s, e) => s + Number(e.taxes_withheld), 0);

    const totalWithheld = Math.max(txWithheld, legacyWithheld) + w2Withheld;

    const totalIncome = businessIncome + personalIncome;
    const totalExpenses = businessExpenses;
    const netProfit = totalIncome - totalExpenses;

    return {
      businessIncome,
      businessExpenses,
      businessNetIncome,
      personalIncome,
      projectedIncome: 0, // filled by tax estimate
      totalIncome,
      totalExpenses,
      netProfit,
      w2Income,
      w2Withheld,
      totalWithheld,
    };
  }, [transactions, rates, incomeEntries, personalEntries]);
}
