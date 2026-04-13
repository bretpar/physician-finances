import { useMemo, useState, useCallback } from "react";
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
import { isFeatureEnabled } from "@/lib/featureFlags";

export type TaxMode = "actual" | "forecast";

export function useTaxEstimate(): {
  estimate: TaxEstimate | null;
  isLoading: boolean;
  taxMode: TaxMode;
  setTaxMode: (mode: TaxMode) => void;
  actualEstimate: TaxEstimate | null;
  forecastEstimate: TaxEstimate | null;
} {
  const [taxMode, setTaxModeRaw] = useState<TaxMode>("actual");

  const setTaxMode = useCallback((mode: TaxMode) => {
    // Only allow forecast mode if the feature is enabled
    if (mode === "forecast" && !isFeatureEnabled("forecast_mode")) return;
    setTaxModeRaw(mode);
  }, []);

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

  const weighted = useWeightedIncome(incomeEntries);
  const annualizedRetirement = useAnnualizedContributions(retirementContribs);

  const isLoading = incLoading || piLoading || txLoading || ratesLoading || milLoading || strLoading || bonLoading || stkLoading || retLoading || tpLoading || tsLoading;

  // Shared base data computation
  const baseData = useMemo(() => {
    if (!rates || !incomeEntries) return null;

    const entries = incomeEntries;
    const personal = personalEntries || [];

    // ── BUSINESS INCOME ──
    const businessIncome = weighted.se;
    const businessW2 = weighted.w2;
    const businessWithheld = weighted.withheld;
    const businessPreTax = weighted.preTax;
    const businessRetirement = weighted.retirement;

    // ── PERSONAL INCOME ──
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

    // ── STOCK GAINS ──
    const stockGains = (stockTxs || [])
      .filter((s) => Number(s.gain_loss) > 0)
      .reduce((sum, s) => sum + Number(s.gain_loss), 0);
    const stockLosses = (stockTxs || [])
      .filter((s) => Number(s.gain_loss) < 0)
      .reduce((sum, s) => sum + Math.abs(Number(s.gain_loss)), 0);
    const netStockGain = Math.max(0, stockGains - stockLosses - personalLosses);

    // ── BUSINESS DEDUCTIONS ──
    const businessExpenses = (transactions || [])
      .filter((t) => t.amount < 0 && t.category !== "Personal" && t.entity !== "Unassigned")
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    const totalMiles = (mileageEntries || []).reduce((s, e) => s + Number(e.miles), 0);
    const mileageDeduction = totalMiles * IRS_MILEAGE_RATE;

    // Taxes already withheld
    const txActualWithholding = (transactions || [])
      .filter((t) => t.transaction_type === "income" && !t.is_deleted)
      .reduce((s, t) => s + Number(t.actual_withholding || 0), 0);

    // Remaining pay periods
    const now = new Date();
    const monthsRemaining = 12 - now.getMonth();
    const receivedEntries = entries.filter((e) => e.status === "received");
    const avgEntriesPerMonth = receivedEntries.length > 0
      ? receivedEntries.length / (now.getMonth() + 1)
      : 1;
    const remainingPayPeriods = Math.max(1, Math.round(avgEntriesPerMonth * monthsRemaining));

    // Additional tax paid
    const quarterlyPaid = taxPayments.reduce((s, p) => s + Number(p.amount), 0);
    const savingsTotal = taxSavings.reduce((s, e) => s + Number(e.amount), 0);
    const additionalTaxPaid = quarterlyPaid + savingsTotal;

    return {
      businessIncome, businessW2, businessWithheld, businessPreTax, businessRetirement,
      totalPersonalIncome, personalW2, personalOrdinary, personalWithheld, personalPreTax, personalRetirement,
      netStockGain, businessExpenses, mileageDeduction,
      txActualWithholding, remainingPayPeriods, additionalTaxPaid,
      entries,
    };
  }, [incomeEntries, personalEntries, weighted, transactions, rates, mileageEntries, stockTxs, annualizedRetirement, taxPayments, taxSavings]);

  // ── ACTUAL ESTIMATE (Core) ──
  const actualEstimate = useMemo(() => {
    if (!rates || !baseData) return null;

    const totalIncome = baseData.businessIncome + baseData.businessW2 + baseData.totalPersonalIncome + baseData.netStockGain;
    const w2Income = baseData.businessW2 + baseData.personalW2 + baseData.personalOrdinary;
    const seIncome = baseData.businessIncome;

    const combinedPreTax = baseData.businessPreTax + baseData.personalPreTax;
    const combined401k = baseData.businessRetirement + baseData.personalRetirement + annualizedRetirement.total;

    const combinedWithheld = Math.max(baseData.businessWithheld, baseData.txActualWithholding) + baseData.personalWithheld;

    return calculateFullEstimate({
      totalIncome, w2Income, seIncome,
      preTaxDeductions: combinedPreTax,
      retirement401k: combined401k,
      businessDeductions: baseData.businessExpenses,
      mileageDeduction: baseData.mileageDeduction,
      taxesWithheld: combinedWithheld,
      filingStatus: rates.filingStatus,
      lastYearTax: rates.lastYearTax,
      standardDeductionOverride: rates.standardDeductionOverride,
      ssWageCap: rates.ssWageCap,
      bnoRate: rates.bnoRate / 100,
      remainingPayPeriods: baseData.remainingPayPeriods,
      additionalTaxPaid: baseData.additionalTaxPaid,
    });
  }, [rates, baseData, annualizedRetirement]);

  // ── FORECAST ESTIMATE (Advanced — includes projected income) ──
  const forecastEstimate = useMemo(() => {
    if (!rates || !baseData || !incomeEntries) return null;

    const existingDates = new Set(baseData.entries.map((e) => e.income_date));
    const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], existingDates);
    const projTotals = getProjectedTotals(projectedPaychecks);

    const totalIncome = baseData.businessIncome + baseData.businessW2 + baseData.totalPersonalIncome + projTotals.grossIncome + baseData.netStockGain;
    const w2Income = baseData.businessW2 + baseData.personalW2 + baseData.personalOrdinary;
    const seIncome = baseData.businessIncome;

    const combinedPreTax = baseData.businessPreTax + baseData.personalPreTax + projTotals.preTaxDeductions;
    const combined401k = baseData.businessRetirement + baseData.personalRetirement + projTotals.retirement401k + annualizedRetirement.total;

    const combinedWithheld = Math.max(baseData.businessWithheld, baseData.txActualWithholding) + baseData.personalWithheld + projTotals.taxesWithheld;

    return calculateFullEstimate({
      totalIncome, w2Income, seIncome,
      preTaxDeductions: combinedPreTax,
      retirement401k: combined401k,
      businessDeductions: baseData.businessExpenses,
      mileageDeduction: baseData.mileageDeduction,
      taxesWithheld: combinedWithheld,
      filingStatus: rates.filingStatus,
      lastYearTax: rates.lastYearTax,
      standardDeductionOverride: rates.standardDeductionOverride,
      ssWageCap: rates.ssWageCap,
      bnoRate: rates.bnoRate / 100,
      remainingPayPeriods: baseData.remainingPayPeriods,
      additionalTaxPaid: baseData.additionalTaxPaid,
    });
  }, [rates, baseData, incomeEntries, streams, bonuses, annualizedRetirement]);

  const estimate = taxMode === "forecast" ? forecastEstimate : actualEstimate;

  return { estimate, isLoading, taxMode, setTaxMode, actualEstimate, forecastEstimate };
}
