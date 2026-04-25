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
import { isExcludedFromBusiness } from "@/lib/businessExclusion";

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
  const todayStr = new Date().toISOString().split("T")[0];

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
  const scopedTaxData = useMemo(() => {
    const makeCanonicalBusiness = (txs: typeof transactions, incomeRows: typeof reconciledIncomeEntries) => {
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const companyByName = new Map(companies.map((c) => [c.name.toLowerCase().trim(), c] as const));

    let grossSE = 0;        // companies with SE toggle enabled
    let grossW2Business = 0; // scorp_w2, w2 booked under a business
    let grossOtherBusiness = 0; // scorp_distribution, other
    const seEligibleByTx = new Map<string, number>();
    let seEligibleExpenses = 0;

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
      // CANONICAL EXCLUSION RULE: personal / excluded / transfer rows MUST
      // NOT contribute to taxable business income. See businessExclusion.ts.
      if (isExcludedFromBusiness(t as any)) continue;
      // Resolve filing type: prefer companies.companyType via source_id, else fall back to tx.company_type
      const company = (t.source_id && companyById.get(t.source_id)) ||
        (t.entity && companyByName.get(t.entity.toLowerCase().trim()));
      const filingRaw = company?.companyType ?? t.company_type;
      const filing = normalizeFilingType(filingRaw);
      const amt = Math.abs(Number(t.amount) || 0);

      if (filing === "1099_schedule_c" || filing === "k1_partnership") {
        if (company?.includeSETaxInRecommendation !== false) {
          grossSE += amt;
          seEligibleTxIds.add(t.id);
          seEligibleByTx.set(t.id, amt);
        } else {
          grossOtherBusiness += amt;
        }
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

    for (const t of txs) {
      if (t.transaction_type !== "expense") continue;
      if (isExcludedFromBusiness(t as any) || t.entity === "Unassigned") continue;
      const company = (t.source_id && companyById.get(t.source_id)) ||
        (t.entity && companyByName.get(t.entity.toLowerCase().trim()));
      const filing = normalizeFilingType(company?.companyType || t.company_type);
      if ((filing === "1099_schedule_c" || filing === "k1_partnership") && company?.includeSETaxInRecommendation !== false) {
        seEligibleExpenses += Math.abs(Number(t.amount) || 0);
      }
    }

    // Enrichment from income_entries — but ONLY for entries linked to a live
    // active transaction. This prevents stale/orphaned income_entries from
    // contributing federal_withholding, retirement, etc.
    const liveTxIds = new Set(
      txs
        .filter((t) => t.transaction_type === "income" && !isExcludedFromBusiness(t as any))
        .map((t) => t.id),
    );
    const linkedEntries = (incomeRows || []).filter(
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
    const seEligibleGross = Array.from(seEligibleByTx.values()).reduce((s, v) => s + v, 0);

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
      seEligibleGross,
      seEligibleExpenses,
    };
    };

    const allTxs = transactions || [];
    const actualTxs = allTxs.filter((t) => t.transaction_date <= todayStr);
    const allIncomeRows = reconciledIncomeEntries || [];
    const actualIncomeRows = allIncomeRows.filter((e) => e.income_date <= todayStr);
    const allPersonalRows = personalEntries || [];
    const actualPersonalRows = allPersonalRows.filter((e) => e.income_date <= todayStr);
    const allStockRows = stockTxs || [];
    const actualStockRows = allStockRows.filter((s) => s.sale_date <= todayStr);

    return {
      actualOnlyTaxInputs: {
        transactions: actualTxs,
        incomeEntries: actualIncomeRows,
        personalEntries: actualPersonalRows,
        stockTransactions: actualStockRows,
        canonicalBusiness: makeCanonicalBusiness(actualTxs, actualIncomeRows),
      },
      includePlannedTaxInputs: {
        transactions: allTxs,
        incomeEntries: allIncomeRows,
        personalEntries: allPersonalRows,
        stockTransactions: allStockRows,
        canonicalBusiness: makeCanonicalBusiness(allTxs, allIncomeRows),
      },
    };
  }, [transactions, reconciledIncomeEntries, personalEntries, stockTxs, companies, rates?.businessStateTaxApplicationMode, rates?.businessStateTaxCompanyIds, todayStr]);

  const isLoading = incLoading || piLoading || txLoading || ratesLoading || milLoading || strLoading || bonLoading || stkLoading || retLoading || tpLoading || tsLoading;

  const scopedBaseInputs = useMemo(() => {
    if (!rates || !reconciledIncomeEntries) return null;

    const buildInput = (
      scope: typeof scopedTaxData.actualOnlyTaxInputs,
      incomeScope: "actualOnly" | "actualPlusPlanned",
    ): Omit<UnifiedTaxInput, "includeProjectedIncome"> => {
      const incomeEntriesClean = scope.incomeEntries;
      const personal = scope.personalEntries;

      const buckets = aggregateByCategory(personal);
      const personalW2 = buckets.w2;
      const personalOrdinary = buckets.ordinary;
      const personalCapGains = buckets.capital_gains;
      const personalRental = buckets.rental;
      const personalLosses = buckets.loss;
      const personalFederalWithheld = personal.reduce((s, e) => s + getTotalFederalPaid(e as any), 0);
      const personalStateWithheld = personal.reduce((s, e) => s + Number((e as any).state_withholding || 0), 0);
      const scopedHsaRows = (hsaRows || []).filter((r) =>
        r.source_type === "individual" && (incomeScope === "actualPlusPlanned" || r.contribution_date <= todayStr),
      );
      const individualHsaTotal = scopedHsaRows.reduce((s, r) => s + Number(r.amount || 0), 0);
      const personalPreTax = personal.reduce(
        (s, e) => s + Number(e.pre_tax_deductions || 0) + Number((e as any).hsa_contribution || 0),
        0,
      ) + individualHsaTotal;
      const personalRetirement = personal.reduce((s, e) => s + Number(e.retirement_401k || 0), 0);

      const totalPersonalIncome = personalW2 + personalOrdinary + personalCapGains + personalRental - personalLosses;
      const personalNonW2Income = Math.max(0, personalOrdinary + personalCapGains + personalRental - personalLosses);

      const stockGains = scope.stockTransactions
        .filter((s) => Number(s.gain_loss) > 0)
        .reduce((sum, s) => sum + Number(s.gain_loss), 0);
      const stockLosses = scope.stockTransactions
        .filter((s) => Number(s.gain_loss) < 0)
        .reduce((sum, s) => sum + Math.abs(Number(s.gain_loss)), 0);
      const netStockGain = Math.max(0, stockGains - stockLosses - personalLosses);

      const businessExpenses = scope.transactions
        .filter((t) => t.transaction_type === "expense" && !isExcludedFromBusiness(t as any) && t.entity !== "Unassigned")
        .reduce((s, t) => s + Math.abs(t.amount), 0);

      const totalMiles = (mileageEntries || []).reduce((s, e) => s + Number(e.miles), 0);
      const mileageDeduction = totalMiles * IRS_MILEAGE_RATE;

      const txActualWithholding = scope.transactions
        .filter((t) => t.transaction_type === "income" && !isExcludedFromBusiness(t as any))
        .reduce((s, t) => s + Number(t.actual_withholding || 0), 0);

      const now = new Date();
      const monthsRemaining = 12 - now.getMonth();
      const receivedEntries = incomeEntriesClean.filter((e) => e.status === "received");
      const avgEntriesPerMonth = receivedEntries.length > 0 ? receivedEntries.length / (now.getMonth() + 1) : 1;
      const remainingPayPeriods = Math.max(1, Math.round(avgEntriesPerMonth * monthsRemaining));

      const quarterlyPaid = taxPayments
        .filter((p) => incomeScope === "actualPlusPlanned" || p.payment_date <= todayStr)
        .reduce((s, p) => s + Number(p.amount), 0);
      const savingsTotal = taxSavings
        .filter((e) => incomeScope === "actualPlusPlanned" || e.savings_date <= todayStr)
        .reduce((s, e) => s + Number(e.amount), 0);

      const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], incomeEntriesClean);
      const projTotals = getProjectedTotals(projectedPaychecks, streams || []);
      const canonicalBusiness = scope.canonicalBusiness;
      const businessIncome = canonicalBusiness.grossSE + canonicalBusiness.grossOtherBusiness;
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
      const seEligibleRatio = totalBG > 0 ? (canonicalBusiness.seEligibleGross || 0) / totalBG : 0;
      const companyById = new Map(companies.map((c) => [c.id, c] as const));
      const streamById = new Map((streams || []).map((s) => [s.id, s] as const));
      const projectedSEIncome = projectedPaychecks.reduce((sum, p) => {
        if (p.matchStatus !== "active") return sum;
        const stream = streamById.get(p.streamId);
        const company = stream?.source_id ? companyById.get(stream.source_id) : undefined;
        const filing = normalizeFilingType(company?.companyType || stream?.company_type || p.streamCompanyType);
        return (filing === "1099_schedule_c" || filing === "k1_partnership") && company?.includeSETaxInRecommendation !== false
          ? sum + p.grossAmount
          : sum;
      }, 0);

      return {
        businessIncome,
        seEligibleBusinessIncome,
        seEligibleBusinessExpenses: canonicalBusiness.seEligibleExpenses,
        seEligibleMileageDeduction: mileageDeduction * seEligibleRatio,
        businessW2,
        businessFederalWithheld,
        businessStateWithheld,
        businessPreTax,
        businessRetirement,
        ownerHealthcare,
        businessStateEligibleGross,
        businessStateEligibleExpenses: businessExpenses * eligibleRatio,
        businessStateEligibleMileage: mileageDeduction * eligibleRatio,
        businessStateEligibleOwnerAdjustments: (ownerHealthcare + businessRetirement) * eligibleRatio,
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
        annualizedRetirement: incomeScope === "actualPlusPlanned" ? annualizedRetirement.total : 0,
        txActualWithholding,
        actualEstimatedPaymentsMade: quarterlyPaid,
        taxSavingsSetAside: savingsTotal,
        remainingPayPeriods,
        projectedW2Income: projTotals.w2Income,
        projectedSEIncome,
        projectedOtherIncome: projTotals.otherIncome + Math.max(0, projTotals.seIncome - projectedSEIncome),
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
        withholdingMethod: rates.withholdingMethod,
        manualEffectiveTaxRate: rates.manualEffectiveTaxRate,
        stateIncomeTaxEnabled: rates.stateIncomeTaxEnabled,
        personalStateTaxMode: rates.personalStateTaxMode,
        personalStateTaxRate: rates.personalStateTaxRate,
        personalStateTaxAnnualEstimate: rates.personalStateTaxAnnualEstimate,
        businessStateTaxEnabled: rates.businessStateTaxEnabled,
        businessStateTaxRate: rates.businessStateTaxRate,
        businessStateTaxBase: rates.businessStateTaxBase,
      };
    };

    return {
      actualOnlyTaxInputs: buildInput(scopedTaxData.actualOnlyTaxInputs, "actualOnly"),
      includePlannedTaxInputs: buildInput(scopedTaxData.includePlannedTaxInputs, "actualPlusPlanned"),
    };
  }, [rates, reconciledIncomeEntries, scopedTaxData, hsaRows, todayStr, mileageEntries, taxPayments, taxSavings, streams, bonuses, companies, annualizedRetirement]);

  const actualResult = useMemo(() => {
    if (!scopedBaseInputs) return null;
    return computeUnifiedTaxEstimate({ ...scopedBaseInputs.actualOnlyTaxInputs, includeProjectedIncome: false });
  }, [scopedBaseInputs]);

  const forecastResult = useMemo(() => {
    if (!scopedBaseInputs) return null;
    return computeUnifiedTaxEstimate({ ...scopedBaseInputs.includePlannedTaxInputs, includeProjectedIncome: true });
  }, [scopedBaseInputs]);

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
