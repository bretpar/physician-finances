import { useMemo } from "react";
import { useIncomeEntries, useWeightedIncome } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useMileageYTD, IRS_MILEAGE_RATE } from "@/hooks/useMileage";
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks, getProjectedTotals } from "@/hooks/useProjectedIncome";
import { useStockTransactions } from "@/hooks/useStocks";
import { useRetirementContributions, useAnnualizedContributions } from "@/hooks/useRetirementContributions";
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { calculateFullEstimate, type TaxEstimate } from "@/lib/taxEngine";

export function useTaxEstimate(): { estimate: TaxEstimate | null; isLoading: boolean } {
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const currentYear = new Date().getFullYear();
  const { data: mileageEntries, isLoading: milLoading } = useMileageYTD(currentYear);
  const { data: streams, isLoading: strLoading } = useProjectedStreams();
  const { data: bonuses, isLoading: bonLoading } = useProjectedBonuses();
  const { data: stockTxs, isLoading: stkLoading } = useStockTransactions();
  const { data: retirementContribs, isLoading: retLoading } = useRetirementContributions();
  const { data: taxPayments = [], isLoading: tpLoading } = useTaxPayments();
  const { data: taxSavings = [], isLoading: tsLoading } = useTaxSavings();

  // Legacy weighted income (for business income entries tied to transactions)
  const weighted = useWeightedIncome(incomeEntries);
  const annualizedRetirement = useAnnualizedContributions(retirementContribs);

  const isLoading = incLoading || piLoading || txLoading || ratesLoading || milLoading || strLoading || bonLoading || stkLoading || retLoading || tpLoading || tsLoading;

  const estimate = useMemo(() => {
    if (!rates || !incomeEntries) return null;

    const entries = incomeEntries;
    const personal = personalEntries || [];

    // ── BUSINESS INCOME (from transactions + linked income_entries) ──
    // Use weighted income from legacy income_entries (business-linked entries)
    const businessIncome = weighted.se; // SE income from business entries
    const businessW2 = weighted.w2; // legacy W2 from old entries
    const businessWithheld = weighted.withheld;
    const businessPreTax = weighted.preTax;
    const businessRetirement = weighted.retirement;

    // ── PERSONAL INCOME (from personal income_entries with source_bucket='personal') ──
    const personalW2 = personal
      .filter((e) => e.income_type === "w2_user" || e.income_type === "w2_partner")
      .reduce((s, e) => s + Number(e.gross_amount), 0);
    const personalOrdinary = personal
      .filter((e) => ["dividend", "interest", "other_income"].includes(e.income_type))
      .reduce((s, e) => s + Number(e.gross_amount), 0);
    const personalCapGains = personal
      .filter((e) => ["short_term_gain", "long_term_gain"].includes(e.income_type))
      .reduce((s, e) => s + Number(e.gross_amount), 0);
    const personalRental = personal
      .filter((e) => e.income_type === "rental")
      .reduce((s, e) => s + Number(e.gross_amount), 0);
    const personalLosses = personal
      .filter((e) => e.income_type === "loss")
      .reduce((s, e) => s + Math.abs(Number(e.gross_amount)), 0);
    const personalWithheld = personal
      .reduce((s, e) => s + Number(e.federal_withholding || 0), 0);
    const personalPreTax = personal
      .reduce((s, e) => s + Number(e.pre_tax_deductions || 0), 0);
    const personalRetirement = personal
      .reduce((s, e) => s + Number(e.retirement_401k || 0), 0);

    const totalPersonalIncome = personalW2 + personalOrdinary + personalCapGains + personalRental - personalLosses;

    // ── PROJECTED INCOME STREAMS (remaining year) ──
    const existingDates = new Set(entries.map((e) => e.income_date));
    const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], existingDates);
    const projTotals = getProjectedTotals(projectedPaychecks);

    // ── STOCK GAINS (legacy stock_transactions table) ──
    const stockGains = (stockTxs || [])
      .filter((s) => Number(s.gain_loss) > 0)
      .reduce((sum, s) => sum + Number(s.gain_loss), 0);
    const stockLosses = (stockTxs || [])
      .filter((s) => Number(s.gain_loss) < 0)
      .reduce((sum, s) => sum + Math.abs(Number(s.gain_loss)), 0);
    const netStockGain = Math.max(0, stockGains - stockLosses - personalLosses);

    // ── COMBINE ALL SOURCES ──
    const totalIncome = weighted.total + totalPersonalIncome + projTotals.grossIncome + netStockGain;
    const w2Income = businessW2 + personalW2 + personalOrdinary;
    const seIncome = businessIncome;

    const combinedPreTax = businessPreTax + personalPreTax + projTotals.preTaxDeductions;
    const combined401k = businessRetirement + personalRetirement + projTotals.retirement401k + annualizedRetirement.total;

    // Taxes already withheld from all sources
    const txActualWithholding = (transactions || [])
      .filter((t) => t.transaction_type === "income" && !t.is_deleted)
      .reduce((s, t) => s + Number(t.actual_withholding || 0), 0);
    const combinedWithheld = Math.max(businessWithheld, txActualWithholding) + personalWithheld + projTotals.taxesWithheld;

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
    const receivedEntries = entries.filter((e) => e.status === "received");
    const avgEntriesPerMonth = receivedEntries.length > 0
      ? receivedEntries.length / (now.getMonth() + 1)
      : 1;
    const remainingPayPeriods = Math.max(1, Math.round(avgEntriesPerMonth * monthsRemaining));

    // Additional tax paid (quarterly payments + tax savings)
    const quarterlyPaid = taxPayments.reduce((s, p) => s + Number(p.amount), 0);
    const savingsTotal = taxSavings.reduce((s, e) => s + Number(e.amount), 0);
    const additionalTaxPaid = quarterlyPaid + savingsTotal;

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
      additionalTaxPaid,
    });
  }, [incomeEntries, personalEntries, weighted, transactions, rates, mileageEntries, streams, bonuses, stockTxs, annualizedRetirement, taxPayments, taxSavings]);

  return { estimate, isLoading };
}
