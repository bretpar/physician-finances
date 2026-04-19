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
import { useCompanies } from "@/contexts/CompanyContext";
import { type TaxEstimate } from "@/lib/taxEngine";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput, type TaxDebugBreakdown } from "@/lib/taxCalculationService";
import { normalizeFilingType, isSelfEmployedFilingType } from "@/lib/filingTypes";
import { aggregateByCategory } from "@/lib/incomeClassification";

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
  const { companies } = useCompanies();

  const weighted = useWeightedIncome(incomeEntries);
  const annualizedRetirement = useAnnualizedContributions(retirementContribs);

  const isLoading = incLoading || piLoading || txLoading || ratesLoading || milLoading || strLoading || bonLoading || stkLoading || retLoading || tpLoading || tsLoading;

  // Build shared base input once
  const baseInput = useMemo(() => {
    if (!rates || !incomeEntries) return null;

    const personal = personalEntries || [];

    // Personal income breakdown — resilient classifier (handles canonical +
    // legacy + missing subtype). Never drops a row; falls back to "ordinary".
    const buckets = aggregateByCategory(personal);
    const personalW2 = buckets.w2;
    const personalOrdinary = buckets.ordinary;
    const personalCapGains = buckets.capital_gains;
    const personalRental = buckets.rental;
    const personalLosses = buckets.loss;
    const personalFederalWithheld = personal
      .reduce((s, e) => s + Number(e.federal_withholding || 0), 0);
    const personalStateWithheld = personal
      .reduce((s, e) => s + Number((e as any).state_withholding || 0), 0);
    const personalPreTax = personal
      .reduce((s, e) => s + Number(e.pre_tax_deductions || 0), 0);
    const personalRetirement = personal
      .reduce((s, e) => s + Number(e.retirement_401k || 0), 0);

    const totalPersonalIncome = personalW2 + personalOrdinary + personalCapGains + personalRental - personalLosses;
    // Personal non-W2 portion → flows into "other income" line on the return.
    const personalNonW2Income = Math.max(0, personalOrdinary + personalCapGains + personalRental - personalLosses);

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

    // Projected totals (bucketed by W-2 / SE / other; fed/state withholding split)
    const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], incomeEntries || []);
    const projTotals = getProjectedTotals(projectedPaychecks, streams || []);

    // Owner healthcare (K-1 deduction)
    const ownerHealthcare = (incomeEntries || [])
      .filter((e) => normalizeFilingType(e.income_type) === "k1_partnership")
      .reduce((s, e) => s + Number((e as any).owner_healthcare || 0), 0);

    // Business federal vs state withholding
    const businessFederalWithheld = (incomeEntries || []).reduce(
      (s, e) => s + Number((e as any).federal_withholding || 0) + Number(e.taxes_withheld || 0),
      0,
    );
    const businessStateWithheld = (incomeEntries || []).reduce(
      (s, e) => s + Number((e as any).state_withholding || 0),
      0,
    );

    // ── SE-eligible business income (Schedule C + K-1 partnership only) ──
    // Excludes scorp_distribution, scorp_w2, w2, other — those are NOT subject
    // to SE tax even though they may be tracked under a "business" company.
    const SE_ELIGIBLE_TYPES = new Set(["1099_schedule_c", "k1_partnership"]);
    const seEligibleBusinessIncome = (incomeEntries || [])
      .filter((e) => SE_ELIGIBLE_TYPES.has(normalizeFilingType(e.income_type)))
      .reduce((s, e) => s + Number(e.paycheck_amount || 0), 0);

    // ── Eligible business income for state business tax ──
    const eligibleCompanyNames = new Set<string>();
    for (const c of companies) {
      const meta = normalizeFilingType(c.companyType);
      const isBusiness = meta === "1099_schedule_c" || meta === "k1_partnership" || meta === "scorp_distribution";
      if (!isBusiness) continue;
      if (c.applyBusinessStateTax === false) continue;
      if (rates.businessStateTaxApplicationMode === "selected" && !rates.businessStateTaxCompanyIds.includes(c.id)) continue;
      eligibleCompanyNames.add(c.name);
    }
    const businessStateEligibleGross = (incomeEntries || [])
      .filter((e) => isSelfEmployedFilingType(e.income_type) && eligibleCompanyNames.has(e.company))
      .reduce((s, e) => s + Number(e.paycheck_amount || 0), 0);
    const totalBusinessGross = weighted.se || 1;
    const eligibleRatio = totalBusinessGross > 0 ? businessStateEligibleGross / totalBusinessGross : 0;
    const businessStateEligibleExpenses = businessExpenses * eligibleRatio;
    const businessStateEligibleMileage = mileageDeduction * eligibleRatio;
    const businessStateEligibleOwnerAdjustments = (ownerHealthcare + weighted.retirement) * eligibleRatio;

    return {
      businessIncome: weighted.se,
      seEligibleBusinessIncome,
      businessW2: weighted.w2,
      businessFederalWithheld,
      businessStateWithheld,
      businessPreTax: weighted.preTax,
      businessRetirement: weighted.retirement,
      ownerHealthcare,
      businessStateEligibleGross,
      businessStateEligibleExpenses,
      businessStateEligibleMileage,
      businessStateEligibleOwnerAdjustments,
      personalIncome: totalPersonalIncome,
      personalW2,
      personalNonW2Income,
      personalFederalWithheld,
      personalStateWithheld,
      personalPreTax,
      personalRetirement,
      netStockGain,
      businessExpenses,
      mileageDeduction,
      annualizedRetirement: annualizedRetirement.total,
      txActualWithholding,
      actualEstimatedPaymentsMade: quarterlyPaid,
      taxSavingsSetAside: savingsTotal,
      remainingPayPeriods,
      projectedW2Income: projTotals.w2Income,
      projectedSEIncome: projTotals.seIncome,
      projectedOtherIncome: projTotals.otherIncome,
      projectedFederalWithheld: projTotals.federalWithheld,
      projectedStateWithheld: projTotals.stateWithheld,
      projectedPreTax: projTotals.preTaxDeductions,
      projectedRetirement: projTotals.retirement401k,
      filingStatus: rates.filingStatus as "single" | "married_filing_jointly",
      lastYearTax: rates.lastYearTax,
      standardDeductionOverride: rates.standardDeductionOverride,
      ssWageCap: rates.ssWageCap,
      deductionType: rates.deductionType,
      itemizedDeductionAmount: rates.itemizedDeductionAmount,
      qualifyingChildrenCount: rates.qualifyingChildrenCount,
      otherDependentsCount: rates.otherDependentsCount,
      withholdingOverrideType: rates.withholdingOverrideType,
      withholdingOverridePercent: rates.withholdingOverridePercent,
      withholdingOverrideAmount: rates.withholdingOverrideAmount,
      stateTaxEnabled: rates.stateTaxEnabled,
      personalStateTaxMode: rates.personalStateTaxMode,
      personalStateTaxRate: rates.personalStateTaxRate,
      personalStateTaxAnnualEstimate: rates.personalStateTaxAnnualEstimate,
      businessStateTaxEnabled: rates.businessStateTaxEnabled,
      businessStateTaxRate: rates.businessStateTaxRate,
      businessStateTaxBase: rates.businessStateTaxBase,
    };
  }, [incomeEntries, personalEntries, weighted, transactions, rates, mileageEntries, stockTxs, streams, bonuses, annualizedRetirement, taxPayments, taxSavings, companies]);

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
