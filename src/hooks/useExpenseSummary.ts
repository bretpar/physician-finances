import { useMemo } from "react";
import { PERSONAL_CATEGORY } from "@/lib/mockData";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { Transaction } from "@/lib/mockData";
import type { Company } from "@/contexts/CompanyContext";

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

type AnyTransaction = DbTransaction | Transaction;

function getAmount(tx: AnyTransaction): number { return tx.amount; }
function getCategory(tx: AnyTransaction): string { return tx.category; }
function getDate(tx: AnyTransaction): string { return "transaction_date" in tx ? tx.transaction_date : tx.date; }
function getEntity(tx: AnyTransaction): string { return "entity" in tx ? (tx as any).entity || "Unassigned" : "Unassigned"; }
function getCompanyType(tx: AnyTransaction): string { return "company_type" in tx ? (tx as any).company_type || "Unassigned" : (tx as Transaction).companyType || "Unassigned"; }
function isExpense(tx: AnyTransaction): boolean { return getAmount(tx) < 0; }

export function useExpenseSummary(transactions: AnyTransaction[], companies?: Company[]): ExpenseSummary {
  return useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const expenses = transactions.filter(isExpense);

    const totalBusinessExpenses = Math.abs(expenses.filter((t) => getCategory(t) !== PERSONAL_CATEGORY).reduce((s, t) => s + getAmount(t), 0));
    const totalPersonalExpenses = Math.abs(expenses.filter((t) => getCategory(t) === PERSONAL_CATEGORY).reduce((s, t) => s + getAmount(t), 0));
    const uncategorizedTotal = Math.abs(expenses.filter((t) => getCategory(t) === "Uncategorized").reduce((s, t) => s + getAmount(t), 0));
    const deductibleTotal = Math.abs(expenses.filter((t) => getCategory(t) !== PERSONAL_CATEGORY && getCategory(t) !== "Uncategorized").reduce((s, t) => s + getAmount(t), 0));
    const unassignedTotal = Math.abs(expenses.filter((t) => getEntity(t) === "Unassigned").reduce((s, t) => s + getAmount(t), 0));

    const mtdExpenses = Math.abs(expenses.filter((t) => { const d = new Date(getDate(t)); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; }).reduce((s, t) => s + getAmount(t), 0));
    const ytdExpenses = Math.abs(expenses.filter((t) => new Date(getDate(t)).getFullYear() === thisYear).reduce((s, t) => s + getAmount(t), 0));

    const byCompany: Record<string, number> = {};
    expenses.forEach((t) => {
      const entity = getEntity(t);
      byCompany[entity] = (byCompany[entity] || 0) + Math.abs(getAmount(t));
    });

    const byCompanyType: Record<string, number> = {};
    expenses.forEach((t) => {
      const ct = getCompanyType(t);
      byCompanyType[ct] = (byCompanyType[ct] || 0) + Math.abs(getAmount(t));
    });

    return { totalBusinessExpenses, totalPersonalExpenses, uncategorizedTotal, deductibleTotal, mtdExpenses, ytdExpenses, unassignedTotal, byCompany, byCompanyType };
  }, [transactions, companies]);
}
