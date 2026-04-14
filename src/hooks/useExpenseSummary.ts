import { useMemo } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { Company } from "@/contexts/CompanyContext";

const PERSONAL_CATEGORY = "Personal";

export interface ExpenseSummary {
  totalBusinessExpenses: number;
  totalPersonalExpenses: number;
  uncategorizedTotal: number;
  deductibleTotal: number;
  mtdExpenses: number;
  ytdExpenses: number;
  unassignedTotal: number;
  byCompany: Record<string, number>;
  byCompanyType: Record<string, number>;
}

function isExpense(tx: DbTransaction): boolean { return tx.amount < 0 && tx.transaction_type !== "transfer"; }

export function useExpenseSummary(transactions: DbTransaction[], companies?: Company[]): ExpenseSummary {
  return useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const expenses = transactions.filter(isExpense);

    const totalBusinessExpenses = Math.abs(expenses.filter((t) => t.category !== PERSONAL_CATEGORY).reduce((s, t) => s + t.amount, 0));
    const totalPersonalExpenses = Math.abs(expenses.filter((t) => t.category === PERSONAL_CATEGORY).reduce((s, t) => s + t.amount, 0));
    const uncategorizedTotal = Math.abs(expenses.filter((t) => t.category === "Uncategorized").reduce((s, t) => s + t.amount, 0));
    const deductibleTotal = Math.abs(expenses.filter((t) => t.category !== PERSONAL_CATEGORY && t.category !== "Uncategorized").reduce((s, t) => s + t.amount, 0));
    const unassignedTotal = Math.abs(expenses.filter((t) => t.entity === "Unassigned").reduce((s, t) => s + t.amount, 0));

    const mtdExpenses = Math.abs(expenses.filter((t) => { const d = new Date(t.transaction_date); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; }).reduce((s, t) => s + t.amount, 0));
    const ytdExpenses = Math.abs(expenses.filter((t) => new Date(t.transaction_date).getFullYear() === thisYear).reduce((s, t) => s + t.amount, 0));

    const byCompany: Record<string, number> = {};
    expenses.forEach((t) => {
      byCompany[t.entity] = (byCompany[t.entity] || 0) + Math.abs(t.amount);
    });

    const byCompanyType: Record<string, number> = {};
    expenses.forEach((t) => {
      const ct = t.company_type || "Unassigned";
      byCompanyType[ct] = (byCompanyType[ct] || 0) + Math.abs(t.amount);
    });

    return { totalBusinessExpenses, totalPersonalExpenses, uncategorizedTotal, deductibleTotal, mtdExpenses, ytdExpenses, unassignedTotal, byCompany, byCompanyType };
  }, [transactions, companies]);
}
