import { useMemo, useCallback } from "react";
import { useTaxModeStore, type TaxMode as SharedTaxMode } from "@/lib/taxModeStore";
import { useIncomeEntries, useWeightedIncome } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useMileageYTD, IRS_MILEAGE_RATE } from "@/hooks/useMileage";
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks, getProjectedTotals } from "@/hooks/useProjectedIncome";
import { useStockTransactions } from "@/hooks/useStocks";
import { aggregateInvestmentTaxBuckets, sumInvestmentActualTaxSaved, useInvestmentIncomeEntries } from "@/hooks/useInvestmentIncome";
import { useRetirementContributions, useAnnualizedContributions } from "@/hooks/useRetirementContributions";
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { useHsaContributions } from "@/hooks/useHsaContributions";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useCompanies } from "@/contexts/CompanyContext";
import { type TaxEstimate } from "@/lib/taxEngine";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput, type TaxDebugBreakdown } from "@/lib/taxCalculationService";
import { normalizeFilingType, isSelfEmployedFilingType } from "@/lib/filingTypes";
import { aggregateByCategory } from "@/lib/incomeClassification";
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { getIncludedHomeOfficeByCompany, getIncludedHomeOfficeTotal } from "@/lib/homeOfficeDeduction";
import { useYtdCatchupEntries, type YtdCatchupEntry } from "@/hooks/useYtdCatchup";

export type TaxMode = "actual" | "forecast";

export function useTaxEstimate(): {
  estimate: TaxEstimate | null;
  isLoading: boolean;
  taxMode: TaxMode;
  setTaxMode: (mode: TaxMode) => void;
  actualEstimate: TaxEstimate | null;
  currentPaceEstimate: TaxEstimate | null;
  forecastEstimate: TaxEstimate | null;
  actualDebug: TaxDebugBreakdown | null;
  currentPaceDebug: TaxDebugBreakdown | null;
  forecastDebug: TaxDebugBreakdown | null;
} {
  const [taxMode, setTaxModeRaw] = useTaxModeStore();

  const setTaxMode = useCallback((mode: SharedTaxMode) => {
    if (mode === "forecast" && !isFeatureEnabled("forecast_mode")) return;
    setTaxModeRaw(mode);
  }, [setTaxModeRaw]);

  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const currentYear = new Date().getFullYear();
  const { data: mileageEntries, isLoading: milLoading } = useMileageYTD(currentYear);
  const { data: streams, isLoading: strLoading } = useProjectedStreams();
  const { data: bonuses, isLoading: bonLoading } = useProjectedBonuses();
  const { data: stockTxs, isLoading: stkLoading } = useStockTransactions();
  const { data: investmentEntries, isLoading: invLoading } = useInvestmentIncomeEntries();
  const { data: retirementContribs, isLoading: retLoading } = useRetirementContributions();
  const { data: taxPayments = [], isLoading: tpLoading } = useTaxPayments();
  const { data: taxSavings = [], isLoading: tsLoading } = useTaxSavings();
  const { data: hsaRows = [] } = useHsaContributions(currentYear);
  const { data: homeOfficeDeductions = [], isLoading: hoLoading } = useHomeOfficeDeductions(currentYear);
  const { companies } = useCompanies();
  const { data: ytdCatchups } = useYtdCatchupEntries();
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
    const allPersonalRows = (personalEntries || []).filter((e) => e.include_in_tax_estimate !== false);
    const actualPersonalRows = allPersonalRows.filter((e) => e.income_date <= todayStr);
    const allStockRows = stockTxs || [];
    const actualStockRows = allStockRows.filter((s) => s.sale_date <= todayStr);
    const allInvestmentRows = investmentEntries || [];
    const actualInvestmentRows = allInvestmentRows.filter((s) => s.entry_date <= todayStr);

    return {
      actualOnlyTaxInputs: {
        transactions: actualTxs,
        incomeEntries: actualIncomeRows,
        personalEntries: actualPersonalRows,
        stockTransactions: actualStockRows,
        investmentEntries: actualInvestmentRows,
        canonicalBusiness: makeCanonicalBusiness(actualTxs, actualIncomeRows),
      },
      includePlannedTaxInputs: {
        transactions: allTxs,
        incomeEntries: allIncomeRows,
        personalEntries: allPersonalRows,
        stockTransactions: allStockRows,
        investmentEntries: allInvestmentRows,
        canonicalBusiness: makeCanonicalBusiness(allTxs, allIncomeRows),
      },
    };
  }, [transactions, reconciledIncomeEntries, personalEntries, stockTxs, investmentEntries, companies, rates?.businessStateTaxApplicationMode, rates?.businessStateTaxCompanyIds, todayStr]);

  const isLoading = incLoading || piLoading || txLoading || ratesLoading || milLoading || strLoading || bonLoading || stkLoading || invLoading || retLoading || tpLoading || tsLoading || hoLoading;

  const scopedBaseInputs = useMemo(() => {
    if (!rates || !reconciledIncomeEntries) return null;

    // Aggregate YTD catch-up entries for the current tax year, bucketed by
    // source type. SAFEGUARD against double-counting: for each catch-up entry,
    // subtract any imported income_entries (entry_kind != 'ytd_catchup') whose
    // income_date falls within the catch-up period_start..period_end and whose
    // source bucket matches. Totals are clamped to >= 0.
    const currentYr = new Date().getFullYear();
    const bucketForFiling = (filing: string | undefined): "w2" | "business" | "other" => {
      const f = (filing || "").toLowerCase();
      if (f === "w2") return "w2";
      if (f === "1099_schedule_c" || f === "k1_partnership" || f === "scorp_distribution") return "business";
      return "other";
    };
    const overlapDebug: Array<Record<string, number | string>> = [];
    const allTxsForOverlap = transactions || [];
    const catchupBuckets = (ytdCatchups || [])
      .filter((c: YtdCatchupEntry) => c.tax_year === currentYr)
      .reduce(
        (acc, c) => {
          const targetBucket: "w2" | "business" | "other" =
            c.source_type === "w2" ? "w2" : c.source_type === "1099_k1" ? "business" : "other";
          const bucket = acc[targetBucket];

          const overlapping = (reconciledIncomeEntries || []).filter((e: any) => {
            if ((e.entry_kind || "regular_paycheck") === "ytd_catchup") return false;
            const d = e.income_date as string | undefined;
            if (!d || d < c.period_start || d > c.period_end) return false;
            if (Number(String(d).slice(0, 4)) !== c.tax_year) return false;
            return bucketForFiling(e.income_type) === targetBucket;
          });
          const sum = (key: string) => overlapping.reduce((s: number, e: any) => s + Number(e[key] || 0), 0);
          const overlapGross = overlapping.reduce((s: number, e: any) => s + Number(e.paycheck_amount || e.gross_amount || 0), 0);
          const overlapFedW = sum("federal_withholding");
          const overlapStateW = sum("state_withholding");
          const overlapPreTax = sum("pre_tax_deductions") + sum("hsa_contribution");
          const overlapRetire = sum("retirement_401k");

          // BUSINESS BUCKET ONLY: also subtract overlapping business income
          // transactions (including this catch-up's own synthetic paired
          // transaction) from gross. This prevents double-counting now that
          // business catch-ups are mirrored into the ledger. We deliberately
          // do NOT subtract federal/state from the catch-up's withholding,
          // because the synthetic transaction has no linked income_entry and
          // therefore contributes 0 to canonicalBusiness.businessFederalWithheld
          // — the catch-up's own withholding totals must still flow through.
          let overlapTxGross = 0;
          if (targetBucket === "business") {
            overlapTxGross = allTxsForOverlap
              .filter((t: any) => {
                if (t.transaction_type !== "income") return false;
                if (t.status && t.status !== "active") return false;
                if (t.excluded_from_reports) return false;
                if (isExcludedFromBusiness(t as any)) return false;
                const d = t.transaction_date as string | undefined;
                if (!d || d < c.period_start || d > c.period_end) return false;
                if (Number(String(d).slice(0, 4)) !== c.tax_year) return false;
                return true;
              })
              .reduce((s: number, t: any) => s + Math.abs(Number(t.amount) || 0), 0);
          }

          const cGross = Math.max(0, (Number(c.gross_income) || 0) - overlapGross - overlapTxGross);
          const cFedW = Math.max(0, (Number(c.federal_withholding) || 0) - overlapFedW);
          const cStateW = Math.max(0, (Number(c.state_withholding) || 0) - overlapStateW);
          const cPreTaxRaw = (Number(c.healthcare_premiums) || 0)
            + (Number(c.dental_vision) || 0)
            + (Number(c.other_pretax) || 0)
            + (Number(c.hsa_contribution) || 0);
          const cPreTax = Math.max(0, cPreTaxRaw - overlapPreTax);
          const cRetire = Math.max(0, (Number(c.retirement_401k) || 0) - overlapRetire);

          if (overlapping.length > 0 || overlapTxGross > 0) {
            overlapDebug.push({
              catchupId: c.id,
              source: c.source_type,
              period: `${c.period_start}..${c.period_end}`,
              overlappingRows: overlapping.length,
              subtractedGross: overlapGross,
              subtractedTxGross: overlapTxGross,
              subtractedFedW: overlapFedW,
            });
          }

          bucket.gross += cGross;
          bucket.federalWithheld += cFedW;
          bucket.stateWithheld += cStateW;
          bucket.preTax += cPreTax;
          bucket.retirement += cRetire;
          return acc;
        },
        {
          w2: { gross: 0, federalWithheld: 0, stateWithheld: 0, preTax: 0, retirement: 0 },
          business: { gross: 0, federalWithheld: 0, stateWithheld: 0, preTax: 0, retirement: 0 },
          other: { gross: 0, federalWithheld: 0, stateWithheld: 0, preTax: 0, retirement: 0 },
        },
      );

    if (overlapDebug.length > 0 && typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[useTaxEstimate] YTD catch-up overlap detected — catch-up totals reduced to prevent double-counting:", overlapDebug);
    }

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
      const investmentBuckets = aggregateInvestmentTaxBuckets(scope.investmentEntries || []);
      // Short-term sales (gain side), non-qualified dividends, and any net stock-transaction
      // gains stay in the ordinary "other income" bucket alongside personal losses netting.
      const netStockGain = Math.max(0, stockGains - stockLosses - personalLosses) + investmentBuckets.ordinaryInvestmentIncome;
      // Long-term sales (gain side) + qualified dividends are taxed at LTCG brackets.
      const longTermCapitalGains = investmentBuckets.longTermCapitalGain;

      const businessExpenses = scope.transactions
        .filter((t) => t.transaction_type === "expense" && !isExcludedFromBusiness(t as any) && t.entity !== "Unassigned")
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const homeOfficeByCompany = getIncludedHomeOfficeByCompany(homeOfficeDeductions);
      const homeOfficeDeduction = getIncludedHomeOfficeTotal(homeOfficeDeductions);
      let seEligibleHomeOfficeDeduction = 0;
      let businessStateEligibleHomeOfficeDeduction = 0;
      for (const [companyId, amount] of homeOfficeByCompany.entries()) {
        const company = companies.find((c) => c.id === companyId);
        const filing = normalizeFilingType(company?.companyType);
        if ((filing === "1099_schedule_c" || filing === "k1_partnership") && company?.includeSETaxInRecommendation !== false) {
          seEligibleHomeOfficeDeduction += amount;
        }
        if (company && (filing === "1099_schedule_c" || filing === "k1_partnership" || filing === "scorp_distribution")) {
          const eligible = company.applyBusinessStateTax !== false
            && (rates.businessStateTaxApplicationMode !== "selected" || rates.businessStateTaxCompanyIds.includes(company.id));
          if (eligible) businessStateEligibleHomeOfficeDeduction += amount;
        }
      }

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
      const manualSavingsTotal = taxSavings
        .filter((e) => incomeScope === "actualPlusPlanned" || e.savings_date <= todayStr)
        .reduce((s, e) => s + Number(e.amount), 0);
      // Per-entry "Additional Tax Reserve" the user marked on income entries
      // is money they manually set aside for taxes (not actual withholding).
      // Roll it into the same non-counted savings bucket so the tax estimator
      // shows it as money already reserved. This must NEVER be added to
      // federal/state/SS/Medicare withholding totals.
      const personalEntryReserves = personal.reduce(
        (s, e) => s + Math.max(0, Number((e as any).additional_tax_reserve || 0)),
        0,
      );
      const businessEntryReserves = incomeEntriesClean.reduce(
        (s, e) =>
          s + (e.linked_transaction_id ? Math.max(0, Number((e as any).additional_tax_reserve || 0)) : 0),
        0,
      );
      // Per-entry actual tax saved on investment income entries (user-entered).
      const investmentActualSaved = sumInvestmentActualTaxSaved(
        (scope.investmentEntries || []).filter((e) => incomeScope === "actualPlusPlanned" || e.entry_date <= todayStr),
      );
      const savingsTotal = manualSavingsTotal + personalEntryReserves + businessEntryReserves + investmentActualSaved;

      const projectedPaychecks = generateProjectedPaychecks(streams || [], bonuses || [], incomeEntriesClean);
      const projTotals = getProjectedTotals(projectedPaychecks, streams || []);
      // Forecast business expenses are user-entered assumptions on 1099 / K-1 streams
      // that reduce projected SE gross to net business profit. Only counted in the
      // "actual + planned" forecast — actual transactions own the expense side in
      // actual-only mode.
      const forecastBusinessExpenses = incomeScope === "actualPlusPlanned"
        ? Number(projTotals.forecastBusinessExpenses || 0)
        : 0;
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

      // ── YTD catch-up injection ─────────────────────────────────────────────
      // Catch-up entries represent prior-period actuals from a paystub. They
      // ALWAYS apply (in both actualOnly and actualPlusPlanned scopes) because
      // they describe income already earned this tax year before the user
      // started tracking in PaycheckMD. They are NOT projected income.
      const cu = catchupBuckets;
      const cuW2Gross = cu.w2.gross;
      const cuBizGross = cu.business.gross;
      const cuOtherGross = cu.other.gross;
      const cuFedW = cu.w2.federalWithheld + cu.business.federalWithheld + cu.other.federalWithheld;
      const cuStateW = cu.w2.stateWithheld + cu.business.stateWithheld + cu.other.stateWithheld;

      return {
        businessIncome: businessIncome + cuBizGross,
        seEligibleBusinessIncome: seEligibleBusinessIncome + cuBizGross,
        seEligibleBusinessExpenses: canonicalBusiness.seEligibleExpenses + seEligibleHomeOfficeDeduction + forecastBusinessExpenses,
        seEligibleMileageDeduction: mileageDeduction * seEligibleRatio,
        businessW2,
        businessFederalWithheld: businessFederalWithheld + cu.business.federalWithheld,
        businessStateWithheld: businessStateWithheld + cu.business.stateWithheld,
        businessPreTax: businessPreTax + cu.business.preTax,
        businessRetirement: businessRetirement + cu.business.retirement,
        ownerHealthcare,
        businessStateEligibleGross: businessStateEligibleGross + cuBizGross,
        businessStateEligibleExpenses: (businessExpenses * eligibleRatio) + businessStateEligibleHomeOfficeDeduction + (forecastBusinessExpenses * eligibleRatio),
        businessStateEligibleMileage: mileageDeduction * eligibleRatio,
        businessStateEligibleOwnerAdjustments: (ownerHealthcare + businessRetirement) * eligibleRatio,
        personalIncome: totalPersonalIncome + investmentDividends + cuW2Gross + cuOtherGross,
        personalW2: personalW2 + cuW2Gross,
        personalNonW2Income: personalNonW2Income + investmentDividends + cuOtherGross,
        personalFederalWithheld: personalFederalWithheld + cu.w2.federalWithheld + cu.other.federalWithheld,
        personalStateWithheld: personalStateWithheld + cu.w2.stateWithheld + cu.other.stateWithheld,
        personalPreTax: personalPreTax + cu.w2.preTax + cu.other.preTax,
        personalRetirement: personalRetirement + cu.w2.retirement + cu.other.retirement,
        netStockGain,
        businessExpenses: businessExpenses + homeOfficeDeduction + forecastBusinessExpenses,
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
  }, [rates, reconciledIncomeEntries, scopedTaxData, hsaRows, todayStr, mileageEntries, taxPayments, taxSavings, streams, bonuses, companies, annualizedRetirement, homeOfficeDeductions, ytdCatchups]);

  const actualResult = useMemo(() => {
    if (!scopedBaseInputs) return null;
    return computeUnifiedTaxEstimate({ ...scopedBaseInputs.actualOnlyTaxInputs, includeProjectedIncome: false });
  }, [scopedBaseInputs]);

  const currentPaceResult = useMemo(() => {
    if (!scopedBaseInputs) return null;
    const now = new Date();
    const elapsedMonths = Math.max(1, now.getMonth() + 1);
    const annualizationFactor = 12 / elapsedMonths;
    const actual = scopedBaseInputs.actualOnlyTaxInputs;

    return computeUnifiedTaxEstimate({
      ...actual,
      businessIncome: actual.businessIncome * annualizationFactor,
      seEligibleBusinessIncome: actual.seEligibleBusinessIncome * annualizationFactor,
      seEligibleBusinessExpenses: (actual.seEligibleBusinessExpenses ?? actual.businessExpenses) * annualizationFactor,
      seEligibleMileageDeduction: (actual.seEligibleMileageDeduction ?? actual.mileageDeduction) * annualizationFactor,
      businessW2: actual.businessW2 * annualizationFactor,
      businessPreTax: actual.businessPreTax * annualizationFactor,
      businessRetirement: actual.businessRetirement * annualizationFactor,
      ownerHealthcare: actual.ownerHealthcare * annualizationFactor,
      businessStateEligibleGross: actual.businessStateEligibleGross * annualizationFactor,
      businessStateEligibleExpenses: actual.businessStateEligibleExpenses * annualizationFactor,
      businessStateEligibleMileage: actual.businessStateEligibleMileage * annualizationFactor,
      businessStateEligibleOwnerAdjustments: actual.businessStateEligibleOwnerAdjustments * annualizationFactor,
      personalIncome: actual.personalIncome * annualizationFactor,
      personalW2: actual.personalW2 * annualizationFactor,
      personalNonW2Income: actual.personalNonW2Income * annualizationFactor,
      personalPreTax: actual.personalPreTax * annualizationFactor,
      personalRetirement: actual.personalRetirement * annualizationFactor,
      netStockGain: actual.netStockGain * annualizationFactor,
      businessExpenses: actual.businessExpenses * annualizationFactor,
      mileageDeduction: actual.mileageDeduction * annualizationFactor,
      annualizedRetirement: actual.annualizedRetirement * annualizationFactor,
      includeProjectedIncome: false,
      rateSourceLabel: "actual/YTD income pace",
    });
  }, [scopedBaseInputs]);

  const forecastResult = useMemo(() => {
    if (!scopedBaseInputs) return null;
    return computeUnifiedTaxEstimate({ ...scopedBaseInputs.includePlannedTaxInputs, includeProjectedIncome: true });
  }, [scopedBaseInputs]);

  const actualEstimate = actualResult?.estimate ?? null;
  const currentPaceEstimate = currentPaceResult?.estimate ?? null;
  const forecastEstimate = forecastResult?.estimate ?? null;
  const estimate = taxMode === "forecast" ? forecastEstimate : actualEstimate;

  return {
    estimate, isLoading, taxMode, setTaxMode,
    actualEstimate, currentPaceEstimate, forecastEstimate,
    actualDebug: actualResult?.debug ?? null,
    currentPaceDebug: currentPaceResult?.debug ?? null,
    forecastDebug: forecastResult?.debug ?? null,
  };
}
