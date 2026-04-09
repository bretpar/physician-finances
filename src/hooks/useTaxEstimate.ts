import { useMemo } from "react";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useMileageYTD, IRS_MILEAGE_RATE } from "@/hooks/useMileage";
import { calculateFullEstimate, type TaxEstimate } from "@/lib/taxEngine";

export function useTaxEstimate(): { estimate: TaxEstimate | null; isLoading: boolean } {
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const currentYear = new Date().getFullYear();
  const { data: mileageEntries, isLoading: milLoading } = useMileageYTD(currentYear);

  const isLoading = incLoading || txLoading || ratesLoading || milLoading;

  const estimate = useMemo(() => {
    if (!rates || !incomeEntries) return null;

    const entries = incomeEntries;
    const totalIncome = entries.reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const w2Income = entries.filter((e) => e.income_type === "W2").reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const seIncome = entries.filter((e) => e.income_type !== "W2").reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const preTaxDeductions = entries.reduce((s, e) => s + Number(e.pre_tax_deductions), 0);
    const retirement401k = entries.reduce((s, e) => s + Number(e.retirement_401k), 0);
    const taxesWithheld = entries.reduce((s, e) => s + Number(e.taxes_withheld), 0);

    // Business deductions from expense transactions
    const businessExpenses = (transactions || [])
      .filter((t) => t.amount < 0 && t.category !== "Personal" && t.entity !== "Unassigned")
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    // Mileage deduction
    const totalMiles = (mileageEntries || []).reduce((s, e) => s + Number(e.miles), 0);
    const mileageDeduction = totalMiles * IRS_MILEAGE_RATE;

    // Remaining pay periods estimate (based on how many income entries we expect)
    const now = new Date();
    const monthsRemaining = 12 - now.getMonth();
    const avgEntriesPerMonth = entries.length > 0
      ? entries.length / (now.getMonth() + 1)
      : 1;
    const remainingPayPeriods = Math.max(1, Math.round(avgEntriesPerMonth * monthsRemaining));

    return calculateFullEstimate({
      totalIncome, w2Income, seIncome, preTaxDeductions, retirement401k,
      businessDeductions: businessExpenses, mileageDeduction, taxesWithheld,
      filingStatus: rates.filingStatus,
      lastYearTax: rates.lastYearTax,
      standardDeductionOverride: rates.standardDeductionOverride,
      ssWageCap: rates.ssWageCap,
      bnoRate: rates.bnoRate / 100,
      remainingPayPeriods,
    });
  }, [incomeEntries, transactions, rates, mileageEntries]);

  return { estimate, isLoading };
}
