import { useMemo } from "react";
import { PERSONAL_CATEGORY } from "@/lib/mockData";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { Transaction } from "@/lib/mockData";

interface ExpenseSummary {
  totalBusinessExpenses: number;
  totalPersonalExpenses: number;
  uncategorizedTotal: number;
  deductibleTotal: number;
  mtdExpenses: number;
  ytdExpenses: number;
}

type AnyTransaction = DbTransaction | Transaction;

function getAmount(tx: AnyTransaction): number {
  return tx.amount;
}

function getCategory(tx: AnyTransaction): string {
  return tx.category;
}

function getDate(tx: AnyTransaction): string {
  return "transaction_date" in tx ? tx.transaction_date : tx.date;
}

function isExpense(tx: AnyTransaction): boolean {
  return getAmount(tx) < 0;
}

export function useExpenseSummary(transactions: AnyTransaction[]): ExpenseSummary {
  return useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const expenses = transactions.filter(isExpense);

    const totalBusinessExpenses = Math.abs(
      expenses
        .filter((t) => getCategory(t) !== PERSONAL_CATEGORY)
        .reduce((s, t) => s + getAmount(t), 0)
    );

    const totalPersonalExpenses = Math.abs(
      expenses
        .filter((t) => getCategory(t) === PERSONAL_CATEGORY)
        .reduce((s, t) => s + getAmount(t), 0)
    );

    const uncategorizedTotal = Math.abs(
      expenses
        .filter((t) => getCategory(t) === "Uncategorized")
        .reduce((s, t) => s + getAmount(t), 0)
    );

    const deductibleTotal = Math.abs(
      expenses
        .filter((t) => getCategory(t) !== PERSONAL_CATEGORY && getCategory(t) !== "Uncategorized")
        .reduce((s, t) => s + getAmount(t), 0)
    );

    const mtdExpenses = Math.abs(
      expenses
        .filter((t) => {
          const d = new Date(getDate(t));
          return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        })
        .reduce((s, t) => s + getAmount(t), 0)
    );

    const ytdExpenses = Math.abs(
      expenses
        .filter((t) => new Date(getDate(t)).getFullYear() === thisYear)
        .reduce((s, t) => s + getAmount(t), 0)
    );

    return {
      totalBusinessExpenses,
      totalPersonalExpenses,
      uncategorizedTotal,
      deductibleTotal,
      mtdExpenses,
      ytdExpenses,
    };
  }, [transactions]);
}
