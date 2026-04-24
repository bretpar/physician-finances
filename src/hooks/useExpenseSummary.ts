import { useMemo } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { Company } from "@/contexts/CompanyContext";
import { isExcludedFromBusiness, PERSONAL_CATEGORY } from "@/lib/businessExclusion";

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

function isExpense(tx: DbTransaction): boolean { return tx.transaction_type === "expense"; }

export function useExpenseSummary(transactions: DbTransaction[], companies?: Company[]): ExpenseSummary {
  return useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const allExpenses = transactions.filter(isExpense);
    // Personal-bucket figure intentionally still surfaces personal-category
    // and explicitly excluded rows so the "Personal Expenses" widget can
    // report them. All BUSINESS aggregations below operate on `expenses`,
    // which strips anything `isExcludedFromBusiness` flags.
    const expenses = allExpenses.filter((t) => !isExcludedFromBusiness(t as any));

    const totalBusinessExpenses = expenses.filter((t) => t.category !== PERSONAL_CATEGORY).reduce((s, t) => s + Math.abs(t.amount), 0);
    // Personal expenses widget: count both Personal-category rows AND any
    // explicitly excluded expense rows, since both represent non-business spend.
    const totalPersonalExpenses = allExpenses
      .filter((t) => t.category === PERSONAL_CATEGORY || isExcludedFromBusiness(t as any))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const uncategorizedTotal = expenses.filter((t) => t.category === "Uncategorized").reduce((s, t) => s + Math.abs(t.amount), 0);
    const deductibleTotal = expenses.filter((t) => t.category !== PERSONAL_CATEGORY && t.category !== "Uncategorized").reduce((s, t) => s + Math.abs(t.amount), 0);
    const unassignedTotal = expenses.filter((t) => t.entity === "Unassigned").reduce((s, t) => s + Math.abs(t.amount), 0);

    const mtdExpenses = expenses.filter((t) => { const d = new Date(t.transaction_date); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; }).reduce((s, t) => s + Math.abs(t.amount), 0);
    const ytdExpenses = expenses.filter((t) => new Date(t.transaction_date).getFullYear() === thisYear).reduce((s, t) => s + Math.abs(t.amount), 0);

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
