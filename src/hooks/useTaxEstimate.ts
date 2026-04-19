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
import { type TaxEstimate } from "@/lib/taxEngine";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput, type TaxDebugBreakdown } from "@/lib/taxCalculationService";
import { normalizeFilingType } from "@/lib/filingTypes";

export type TaxMode = "actual" | "forecast";

export function useTaxEstimate(): {
  estimate: TaxEstimate | null;
  isLoading: boolean;
  taxMode: TaxMode;
  setTaxMode: (mode: TaxMode) => void;
  actualEstimate: TaxEstimate | null;
  forecastEstimate: TaxEstimate | null;
  actualDebug: TaxDebugBreakdown | null;
  forecastDebug: TaxDebugBreakdown | null;
} {
  const [taxMode, setTaxModeRaw] = useState<TaxMode>("actual");

  const setTaxMode = useCallback((mode: TaxMode) => {
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

  // Build shared base input once
  const baseInput = useMemo(() => {
    if (!rates || !incomeEntries) return null;

    const personal = personalEntries || [];

    // Personal income breakdown
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

    // Stock gains
    const stockGains = (stockTxs || [])
      .filter((s) => Number(s.gain_loss) > 0)
      .reduce((sum, s) => sum + Number(s.gain_loss), 0);
    const stockLosses = (stockTxs || [])
      .filter((s) => Number(s.gain_loss) < 0)
      .reduce((sum, s) => sum + Math.abs(Number(s.gain_loss)), 0);
    const netStockGain = Math.max(0, stockGains - stockLosses - personalLosses);

    // Business expenses
    const businessExpenses = (transactions || [])
      .filter((t) => t.transaction_type === "expense" && !t.is_deleted && t.category !== "Personal" && t.entity !== "Unassigned")
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    const totalMiles = (mileageEntries || []).reduce((s, e) => s + Number(e.miles), 0);
    const mileageDeduction = totalMiles * IRS_MILEAGE_RATE;

    // User reserves (NOT taxes paid)
    const txActualWithholding = (transactions || [])
      .filter((t) => t.transaction_type === "income" && !t.is_deleted)
      .reduce((s, t) => s + Number(t.actual_withholding || 0), 0);

    // Remaining pay periods
    const now = new Date();
    const monthsRemaining = 12 - now.getMonth();
    const receivedEntries = incomeEntries.filter((e) => e.status === "received");
    const avgEntriesPerMonth = receivedEntries.length > 0
      ? receivedEntries.length / (now.getMonth() + 1)
      : 1;
    const remainingPayPeriods = Math.max(1, Math.round(avgEntriesPerMonth * monthsRemaining));

    const quarterlyPaid = taxPayments.reduce((s, p) => s + Number(p.amount), 0);
    const savingsTotal = taxSavings.reduce((s, e) => s + Number(e.amount), 0);

    // Projected totals
    const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], incomeEntries || []);
    const projTotals = getProjectedTotals(projectedPaychecks);

    // Owner healthcare (K-1 deduction)
    const ownerHealthcare = (incomeEntries || [])
      .filter((e) => normalizeFilingType(e.income_type) === "k1_partnership")
      .reduce((s, e) => s + Number((e as any).owner_healthcare || 0), 0);

    return {
      businessIncome: weighted.se,
      businessW2: weighted.w2,
      businessWithheld: weighted.withheld,
      businessPreTax: weighted.preTax,
      businessRetirement: weighted.retirement,
      ownerHealthcare,
      personalIncome: totalPersonalIncome,
      personalW2,
      personalWithheld,
      personalPreTax,
      personalRetirement,
      netStockGain,
      businessExpenses,
      mileageDeduction,
      annualizedRetirement: annualizedRetirement.total,
      txActualWithholding,
      quarterlyPaid,
      savingsTotal,
      remainingPayPeriods,
      projectedGrossIncome: projTotals.grossIncome,
      projectedTaxesWithheld: projTotals.taxesWithheld,
      projectedPreTax: projTotals.preTaxDeductions,
      projectedRetirement: projTotals.retirement401k,
      filingStatus: rates.filingStatus as "single" | "married_filing_jointly",
      lastYearTax: rates.lastYearTax,
      standardDeductionOverride: rates.standardDeductionOverride,
      ssWageCap: rates.ssWageCap,
      bnoRate: rates.bnoRate / 100,
      deductionType: rates.deductionType,
      itemizedDeductionAmount: rates.itemizedDeductionAmount,
      qualifyingChildrenCount: rates.qualifyingChildrenCount,
      otherDependentsCount: rates.otherDependentsCount,
      withholdingOverrideType: rates.withholdingOverrideType,
      withholdingOverridePercent: rates.withholdingOverridePercent,
      withholdingOverrideAmount: rates.withholdingOverrideAmount,
    };
  }, [incomeEntries, personalEntries, weighted, transactions, rates, mileageEntries, stockTxs, streams, bonuses, annualizedRetirement, taxPayments, taxSavings]);

  // Actual estimate (no projected income)
  const actualResult = useMemo(() => {
    if (!baseInput) return null;
    return computeUnifiedTaxEstimate({ ...baseInput, includeProjectedIncome: false });
  }, [baseInput]);

  // Forecast estimate (with projected income)
  const forecastResult = useMemo(() => {
    if (!baseInput) return null;
    return computeUnifiedTaxEstimate({ ...baseInput, includeProjectedIncome: true });
  }, [baseInput]);

  const actualEstimate = actualResult?.estimate ?? null;
  const forecastEstimate = forecastResult?.estimate ?? null;
  const estimate = taxMode === "forecast" ? forecastEstimate : actualEstimate;

  return {
    estimate, isLoading, taxMode, setTaxMode,
    actualEstimate, forecastEstimate,
    actualDebug: actualResult?.debug ?? null,
    forecastDebug: forecastResult?.debug ?? null,
  };
}
