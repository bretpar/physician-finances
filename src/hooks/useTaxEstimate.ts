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
import { useHsaContributions } from "@/hooks/useHsaContributions";
import { useCompanies } from "@/contexts/CompanyContext";
import { type TaxEstimate } from "@/lib/taxEngine";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput, type TaxDebugBreakdown } from "@/lib/taxCalculationService";
import { normalizeFilingType, isSelfEmployedFilingType } from "@/lib/filingTypes";
import { aggregateByCategory } from "@/lib/incomeClassification";
import { getTotalFederalPaid } from "@/lib/federalWithholding";

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
  const { data: hsaRows = [] } = useHsaContributions(currentYear);
  const { companies } = useCompanies();

  // ── Reconcile income_entries before any tax math ─────────────────────────
  // Two failure modes we defend against:
  //  1) ORPHANS — an income_entry with a linked_transaction_id pointing at a
  //     transaction that no longer exists (e.g. user deleted the manual income
  //     row in Business Activity but the income_entry was left behind). These
  //     would otherwise inflate Gross Business Income on the Taxes page even
  //     though Business Activity no longer shows them.
  //  2) DUPLICATES — same company + same income_date + same paycheck_amount
  //     appearing twice (e.g. user re-entered after a delete, or a manual
  //     entry + Plaid import both got promoted to income_entries). We keep the
  //     row that's still linked to a live transaction; otherwise we keep one.
  const reconciledIncomeEntries = useMemo(() => {
    if (!incomeEntries) return undefined;
    const liveTxIds = new Set((transactions || []).map((t) => t.id));

    // 1) Drop orphans (linked_transaction_id set but transaction missing)
    const notOrphans = incomeEntries.filter((e) => {
      if (!e.linked_transaction_id) return true; // unlinked is fine
      return liveTxIds.has(e.linked_transaction_id);
    });

    // 2) Dedupe by exact (company|date|amount). Prefer the live-linked row.
    const byKey = new Map<string, typeof notOrphans[number]>();
    for (const e of notOrphans) {
      const key = `${e.company || ""}|${e.income_date}|${Number(e.paycheck_amount || 0).toFixed(2)}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, e);
        continue;
      }
      const existingLinked = !!existing.linked_transaction_id && liveTxIds.has(existing.linked_transaction_id);
      const candidateLinked = !!e.linked_transaction_id && liveTxIds.has(e.linked_transaction_id);
      if (candidateLinked && !existingLinked) {
        byKey.set(key, e);
      } else if (candidateLinked === existingLinked) {
        const newer = new Date(e.updated_at || e.created_at) > new Date(existing.updated_at || existing.created_at) ? e : existing;
        byKey.set(key, newer);
      }
    }

    const result = Array.from(byKey.values());

    if (typeof window !== "undefined") {
      const orphanCount = incomeEntries.length - notOrphans.length;
      const dupeCount = notOrphans.length - result.length;
      if (orphanCount > 0 || dupeCount > 0) {
        // eslint-disable-next-line no-console
        console.warn("[useTaxEstimate] income_entries reconciliation:", {
          total: incomeEntries.length,
          excludedOrphans: orphanCount,
          excludedDuplicates: dupeCount,
          included: result.length,
          includedBusinessGross: result.reduce((s, e) => s + Number(e.paycheck_amount || 0), 0),
        });
      }
    }
    return result;
  }, [incomeEntries, transactions]);

  const weighted = useWeightedIncome(reconciledIncomeEntries);
  const annualizedRetirement = useAnnualizedContributions(retirementContribs);

  // ── Canonical business income (matches Business Ledger exactly) ──────────
  // The Business Ledger reads `transactions` where status='active'. Tax math
  // MUST use the same set, otherwise a manually deleted transaction can leave
  // the ledger and Tax Overview disagreeing. We classify each active income
  // transaction by its company's filing type (preferred) or its denormalized
  // company_type field (fallback) into:
  //   - W-2 (scorp_w2, w2)             → not subject to SE tax
  //   - SE  (1099_schedule_c, k1)      → subject to SE tax
  //   - other (scorp_distribution etc.)→ ordinary, no SE
  //
  // income_entries is then used ONLY as an enrichment layer for the canonical
  // transactions, providing per-paycheck withholding / retirement / pre-tax
  // / healthcare_deduction values. Income_entries with no live linked transaction
  // contribute nothing — they cannot inflate gross above what the ledger shows.
  const canonicalBusiness = useMemo(() => {
    const txs = transactions || [];
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const companyByName = new Map(companies.map((c) => [c.name.toLowerCase().trim(), c] as const));

    let grossSE = 0;        // 1099 + K-1 (subject to SE tax)
    let grossW2Business = 0; // scorp_w2, w2 booked under a business
    let grossOtherBusiness = 0; // scorp_distribution, other

    const seEligibleTxIds = new Set<string>();
    const businessStateEligibleByTx = new Map<string, number>();

    // Build eligible-company set for state business tax
    const eligibleCompanyIds = new Set<string>();
    const eligibleCompanyNames = new Set<string>();
    for (const c of companies) {
      const meta = normalizeFilingType(c.companyType);
      const isBusiness = meta === "1099_schedule_c" || meta === "k1_partnership" || meta === "scorp_distribution";
      if (!isBusiness) continue;
      if (c.applyBusinessStateTax === false) continue;
      if (rates?.businessStateTaxApplicationMode === "selected" && !rates.businessStateTaxCompanyIds.includes(c.id)) continue;
      eligibleCompanyIds.add(c.id);
      eligibleCompanyNames.add(c.name.toLowerCase().trim());
    }

    for (const t of txs) {
      if (t.transaction_type !== "income") continue;
      // Resolve filing type: prefer companies.companyType via source_id, else fall back to tx.company_type
      const company = (t.source_id && companyById.get(t.source_id)) ||
        (t.entity && companyByName.get(t.entity.toLowerCase().trim()));
      const filingRaw = company?.companyType ?? t.company_type;
      const filing = normalizeFilingType(filingRaw);
      const amt = Math.abs(Number(t.amount) || 0);

      if (filing === "1099_schedule_c" || filing === "k1_partnership") {
        grossSE += amt;
        seEligibleTxIds.add(t.id);
      } else if (filing === "scorp_w2" || filing === "w2") {
        grossW2Business += amt;
      } else {
        grossOtherBusiness += amt;
      }

      // State business tax eligibility check
      const isBusinessFiling = filing === "1099_schedule_c" || filing === "k1_partnership" || filing === "scorp_distribution";
      if (isBusinessFiling) {
        const eligible = company
          ? eligibleCompanyIds.has(company.id)
          : eligibleCompanyNames.has((t.entity || "").toLowerCase().trim());
        if (eligible) businessStateEligibleByTx.set(t.id, amt);
      }
    }

    // Enrichment from income_entries — but ONLY for entries linked to a live
    // active transaction. This prevents stale/orphaned income_entries from
    // contributing federal_withholding, retirement, etc.
    const liveTxIds = new Set(txs.filter((t) => t.transaction_type === "income").map((t) => t.id));
    const linkedEntries = (reconciledIncomeEntries || []).filter(
      (e) => e.linked_transaction_id && liveTxIds.has(e.linked_transaction_id),
    );

    const businessFederalWithheld = linkedEntries.reduce((s, e) => s + getTotalFederalPaid(e as any), 0);
    const businessStateWithheld = linkedEntries.reduce((s, e) => s + Number((e as any).state_withholding || 0), 0);
    // Pre-tax = `pre_tax_deductions` field + payroll HSA on the same paycheck.
    // Payroll HSA is captured on income_entries.hsa_contribution and treated
    // as pre-tax (Section 125) for AGI purposes. Individual HSA is added later
    // as an above-the-line deduction via personalPreTax.
    const businessPreTax = linkedEntries.reduce(
      (s, e) => s + Number(e.pre_tax_deductions || 0) + Number((e as any).hsa_contribution || 0),
      0,
    );
    const businessRetirement = linkedEntries.reduce((s, e) => s + Number(e.retirement_401k || 0), 0);
    const ownerHealthcare = linkedEntries
      .filter((e) => normalizeFilingType(e.income_type) === "k1_partnership")
      .reduce((s, e) => s + Number((e as any).healthcare_deduction || 0), 0);

    const businessStateEligibleGross = Array.from(businessStateEligibleByTx.values()).reduce((s, v) => s + v, 0);

    return {
      grossSE,
      grossW2Business,
      grossOtherBusiness,
      totalBusinessGross: grossSE + grossW2Business + grossOtherBusiness,
      businessFederalWithheld,
      businessStateWithheld,
      businessPreTax,
      businessRetirement,
      ownerHealthcare,
      businessStateEligibleGross,
    };
  }, [transactions, reconciledIncomeEntries, companies, rates?.businessStateTaxApplicationMode, rates?.businessStateTaxCompanyIds]);

  const isLoading = incLoading || piLoading || txLoading || ratesLoading || milLoading || strLoading || bonLoading || stkLoading || retLoading || tpLoading || tsLoading;

  // Build shared base input once
  const baseInput = useMemo(() => {
    if (!rates || !reconciledIncomeEntries) return null;
    const incomeEntriesClean = reconciledIncomeEntries;

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
      .reduce((s, e) => s + getTotalFederalPaid(e as any), 0);
    const personalStateWithheld = personal
      .reduce((s, e) => s + Number((e as any).state_withholding || 0), 0);
    // Personal pre-tax = pre_tax_deductions field + payroll HSA on personal
    // paychecks + manual individual HSA contributions (above-the-line). HSA
    // rows of source_type='payroll' are EXCLUDED to prevent double counting
    // with the per-paycheck hsa_contribution field above.
    const individualHsaTotal = (hsaRows || [])
      .filter((r) => r.source_type === "individual")
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const personalPreTax = personal
      .reduce(
        (s, e) => s + Number(e.pre_tax_deductions || 0) + Number((e as any).hsa_contribution || 0),
        0,
      ) + individualHsaTotal;
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
      .filter((t) => t.transaction_type === "expense" && t.category !== "Personal" && t.entity !== "Unassigned")
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    const totalMiles = (mileageEntries || []).reduce((s, e) => s + Number(e.miles), 0);
    const mileageDeduction = totalMiles * IRS_MILEAGE_RATE;

    // User reserves (NOT taxes paid)
    const txActualWithholding = (transactions || [])
      .filter((t) => t.transaction_type === "income")
      .reduce((s, t) => s + Number(t.actual_withholding || 0), 0);

    // Remaining pay periods
    const now = new Date();
    const monthsRemaining = 12 - now.getMonth();
    const receivedEntries = incomeEntriesClean.filter((e) => e.status === "received");
    const avgEntriesPerMonth = receivedEntries.length > 0
      ? receivedEntries.length / (now.getMonth() + 1)
      : 1;
    const remainingPayPeriods = Math.max(1, Math.round(avgEntriesPerMonth * monthsRemaining));

    const quarterlyPaid = taxPayments.reduce((s, p) => s + Number(p.amount), 0);
    const savingsTotal = taxSavings.reduce((s, e) => s + Number(e.amount), 0);

    // Projected totals (bucketed by W-2 / SE / other; fed/state withholding split)
    const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], incomeEntriesClean);
    const projTotals = getProjectedTotals(projectedPaychecks, streams || []);

    // ── BUSINESS INCOME: derived from canonical transactions, not income_entries ──
    // This is the single source of truth that the Business Ledger also reads.
    // (See `canonicalBusiness` above.) income_entries only enriches this with
    // per-paycheck withholding/retirement/owner-healthcare values.
    const businessIncome = canonicalBusiness.grossSE;
    const seEligibleBusinessIncome = canonicalBusiness.grossSE;
    const businessW2 = canonicalBusiness.grossW2Business;
    const businessFederalWithheld = canonicalBusiness.businessFederalWithheld;
    const businessStateWithheld = canonicalBusiness.businessStateWithheld;
    const businessPreTax = canonicalBusiness.businessPreTax;
    const businessRetirement = canonicalBusiness.businessRetirement;
    const ownerHealthcare = canonicalBusiness.ownerHealthcare;
    const businessStateEligibleGross = canonicalBusiness.businessStateEligibleGross;

    const totalBG = canonicalBusiness.totalBusinessGross || 0;
    const eligibleRatio = totalBG > 0 ? businessStateEligibleGross / totalBG : 0;
    const businessStateEligibleExpenses = businessExpenses * eligibleRatio;
    const businessStateEligibleMileage = mileageDeduction * eligibleRatio;
    const businessStateEligibleOwnerAdjustments = (ownerHealthcare + businessRetirement) * eligibleRatio;

    return {
      businessIncome,
      seEligibleBusinessIncome,
      businessW2,
      businessFederalWithheld,
      businessStateWithheld,
      businessPreTax,
      businessRetirement,
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
      projectedHealthInsuranceDeduction: projTotals.healthInsuranceDeduction,
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
  }, [reconciledIncomeEntries, personalEntries, canonicalBusiness, transactions, rates, mileageEntries, stockTxs, streams, bonuses, annualizedRetirement, taxPayments, taxSavings, companies, hsaRows]);

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
