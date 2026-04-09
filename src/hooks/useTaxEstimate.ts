import { useMemo } from "react";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useMileageYTD, IRS_MILEAGE_RATE } from "@/hooks/useMileage";
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks, getProjectedTotals } from "@/hooks/useProjectedIncome";
import { calculateFullEstimate, type TaxEstimate } from "@/lib/taxEngine";

export function useTaxEstimate(): { estimate: TaxEstimate | null; isLoading: boolean } {
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const currentYear = new Date().getFullYear();
  const { data: mileageEntries, isLoading: milLoading } = useMileageYTD(currentYear);
  const { data: streams, isLoading: strLoading } = useProjectedStreams();
  const { data: bonuses, isLoading: bonLoading } = useProjectedBonuses();

  const isLoading = incLoading || txLoading || ratesLoading || milLoading || strLoading || bonLoading;

  const estimate = useMemo(() => {
    if (!rates || !incomeEntries) return null;

    const entries = incomeEntries;
    const totalActualIncome = entries.reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const w2ActualIncome = entries.filter((e) => e.income_type === "W2").reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const seActualIncome = entries.filter((e) => e.income_type !== "W2").reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const preTaxDeductions = entries.reduce((s, e) => s + Number(e.pre_tax_deductions), 0);
    const retirement401k = entries.reduce((s, e) => s + Number(e.retirement_401k), 0);
    const taxesWithheld = entries.reduce((s, e) => s + Number(e.taxes_withheld), 0);

    // Projected income (remaining year)
    const existingDates = new Set(entries.map((e) => e.income_date));
    const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], existingDates);
    const projTotals = getProjectedTotals(projectedPaychecks);

    // Combine actual + projected
    const totalIncome = totalActualIncome + projTotals.grossIncome;
    const w2Income = w2ActualIncome + projTotals.grossIncome; // projected streams are W2
    const seIncome = seActualIncome; // projected is W2 only
    const combinedPreTax = preTaxDeductions + projTotals.preTaxDeductions;
    const combined401k = retirement401k + projTotals.retirement401k;
    const combinedWithheld = taxesWithheld + projTotals.taxesWithheld;

    // Business deductions from expense transactions
    const businessExpenses = (transactions || [])
      .filter((t) => t.amount < 0 && t.category !== "Personal" && t.entity !== "Unassigned")
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    // Mileage deduction
    const totalMiles = (mileageEntries || []).reduce((s, e) => s + Number(e.miles), 0);
    const mileageDeduction = totalMiles * IRS_MILEAGE_RATE;

    // Remaining pay periods estimate
    const now = new Date();
    const monthsRemaining = 12 - now.getMonth();
    const avgEntriesPerMonth = entries.length > 0
      ? entries.length / (now.getMonth() + 1)
      : 1;
    const remainingPayPeriods = Math.max(1, Math.round(avgEntriesPerMonth * monthsRemaining));

    return calculateFullEstimate({
      totalIncome, w2Income, seIncome,
      preTaxDeductions: combinedPreTax,
      retirement401k: combined401k,
      businessDeductions: businessExpenses, mileageDeduction,
      taxesWithheld: combinedWithheld,
      filingStatus: rates.filingStatus,
      lastYearTax: rates.lastYearTax,
      standardDeductionOverride: rates.standardDeductionOverride,
      ssWageCap: rates.ssWageCap,
      bnoRate: rates.bnoRate / 100,
      remainingPayPeriods,
    });
  }, [incomeEntries, transactions, rates, mileageEntries, streams, bonuses]);

  return { estimate, isLoading };
}
