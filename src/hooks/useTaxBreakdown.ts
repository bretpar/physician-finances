// ============================================================================
// useTaxBreakdown — PRESENTATION ADAPTER (no independent tax math)
// ============================================================================
// This hook is the data layer for the "Tax Breakdown" tab. It used to run its
// own tax calculation (AGI, taxable income, federal tax, credits, SE tax,
// state tax, total estimated tax, effective rate) which routinely drifted
// from the Tax Overview because the two paths reconciled income_entries /
// transactions / projected streams differently.
//
// Now ALL totals come from the ONE unified engine via `useTaxEstimate`. This
// hook only:
//   1) Builds per-company source cards (W-2 / business / cap gains / other)
//      for the "Income sources" grid — pure aggregation, no tax math.
//   2) Re-exposes the engine's debug values under stable names that the
//      breakdown UI components already consume (`agi`, `totalTaxableIncome`,
//      `federalTaxBeforeCredits`, `dependentCredits`, `totalEstimatedTax`,
//      `effectiveRate`, etc.).
//   3) Recomputes bracket-line display from the engine's resolved
//      `totalTaxableIncome` so the bracket cards in MathAccordion always
//      tie out to the engine's `federalTaxBeforeCredits`. A dev-only
//      guardrail logs if they diverge.
//
// Anything that was previously computed here (and could disagree with
// useTaxEstimate) has been removed. Adding new tax-affecting logic? Put it
// in `taxEngine.ts` / `taxCalculationService.ts` so every screen sees it.
// ============================================================================

import { useMemo } from "react";
import { logTaxBreakdown } from "@/lib/taxBreakdownDebug";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useCompanies } from "@/contexts/CompanyContext";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  useProjectedStreams,
  useProjectedBonuses,
  useStreamOverrides,
  generateProjectedPaychecks,
} from "@/hooks/useProjectedIncome";
import { mapToScheduleC, type ScheduleCCategory } from "@/lib/scheduleC";
import { useMileageYTD, getIrsMileageRate } from "@/hooks/useMileage";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useInvestmentIncomeEntries, aggregateInvestmentTaxBuckets } from "@/hooks/useInvestmentIncome";
import { normalizeFilingType, type FilingType } from "@/lib/filingTypes";
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { aggregatePlannedBusinessExpenses } from "@/lib/plannedBusinessExpenses";
import { getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";
import { getDisplayedEffectiveRatePct } from "@/lib/effectiveTaxRateDisplay";
import {
  ORDINARY_BRACKETS,
  calcBracketTax,
  getMarginalRate,
  type FilingStatus,
  type BracketCalc,
} from "@/lib/taxBrackets";

export type TaxBreakdownMode = "actual" | "forecast";

export interface CategoryBreakdown {
  category: ScheduleCCategory;
  total: number;
  count: number;
}

export interface BusinessBreakdown {
  kind: "business";
  companyId: string | null;
  companyName: string;
  filingType: FilingType;
  revenue: number;
  actualRevenue: number;
  plannedRevenue: number;
  expenses: number;
  profit: number;
  actualProfit: number;
  plannedProfit: number;
  expenseCategories: CategoryBreakdown[];
  expenseTxCount: number;
}

export interface W2Breakdown {
  kind: "w2";
  companyName: string;
  grossWages: number;
  actualGrossWages: number;
  plannedGrossWages: number;
  federalWithheld: number;
  stateWithheld: number;
  preTaxDeductions: number;
  retirement401k: number;
  taxableWages: number;
  /** Employee payroll HSA (Section 125 — excluded from FICA wages). */
  payrollHsa: number;
  /** payrollHsa + preTaxDeductions — the amount subtracted from FICA wages. */
  section125Deductions: number;
}

export interface CapGainsBreakdown {
  kind: "capital_gains";
  source: string;
  shortTerm: number;
  longTerm: number;
  losses: number;
  net: number;
  dividends: number;
  qualifiedDividends: number;
  nonQualifiedDividends: number;
}

export interface OtherIncomeBreakdown {
  kind: "other";
  companyName: string;
  filingType: FilingType;
  grossAmount: number;
  actualGrossAmount: number;
  plannedGrossAmount: number;
  taxableAmount: number;
}

export type IncomeSourceBreakdown =
  | BusinessBreakdown
  | W2Breakdown
  | CapGainsBreakdown
  | OtherIncomeBreakdown;

export interface TaxBreakdownResult {
  mode: TaxBreakdownMode;
  filingStatus: FilingStatus;
  // Sources (per-company aggregation, display-only)
  sources: IncomeSourceBreakdown[];
  // Aggregates from engine
  totalBusinessRevenue: number;
  totalBusinessExpenses: number;
  totalBusinessProfit: number;
  totalW2Income: number;
  totalShortTermGains: number;
  totalLongTermGains: number;
  totalOtherIncome: number;
  totalGrossIncome: number;
  totalReturnIncomeBeforeAdjustments: number;
  w2PreTaxDeductions: number;
  w2TaxableIncomeBase: number;
  /** Total W-2 payroll HSA across all sources (Section 125 — excluded from FICA). */
  w2PayrollHsa: number;
  /** Total Section 125 deductions (payrollHsa + qualified premiums) excluded from FICA. */
  w2Section125Deductions: number;
  totalDeductions: number;
  preTaxDeductions: number;
  retirement401k: number;
  healthInsuranceDeduction: number;
  actualHealthInsuranceDeduction: number;
  projectedHealthInsuranceDeduction: number;
  deductionSourceBreakdown: string;
  agi: number;
  standardDeduction: number;
  itemizedDeduction: number;
  deductionApplied: number;
  deductionType: "standard" | "itemized";
  seDeductibleHalf: number;
  // Planned-only totals (zero in actual mode)
  plannedBusinessRevenue: number;
  plannedW2Income: number;
  plannedOtherIncome: number;
  plannedPreTax: number;
  plannedRetirement: number;
  plannedTotalIncome: number;
  // Actual-only totals (always YTD)
  actualBusinessRevenue: number;
  actualW2Income: number;
  actualOtherIncome: number;
  // Tax math (FROM ENGINE — single source of truth)
  taxableOrdinaryIncome: number;
  taxableLTCG: number;
  totalTaxableIncome: number;
  ordinaryBracketCalc: BracketCalc;
  ltcgBracketCalc: BracketCalc;
  seTax: {
    netSEIncome: number;
    seBase: number;
    ssTax: number;
    medicareTax: number;
    additionalMedicare: number;
    total: number;
    deductibleHalf: number;
  };
  federalTaxBeforeCredits: number;
  dependentCredits: number;
  /** alias = dependentCredits (kept for IRS-style naming consistency) */
  taxCredits: number;
  /** federalTaxBeforeCredits − taxCredits (engine's `federalTax`) */
  federalTaxAfterCredits: number;
  qualifyingChildrenCount: number;
  otherDependentsCount: number;
  totalEstimatedTax: number;
  personalStateTax: number;
  businessStateTax: number;
  stateTax: number;
  // Withheld / paid (FROM ENGINE — same definition as Tax Overview)
  federalWithheldPaid: number;
  stateWithheldPaid: number;
  estimatedPaymentsMade: number;
  countedCreditsTotal: number;
  remainingTaxDue: number;
  effectiveRate: number; // 0-1
  marginalRate: number; // 0-1
  // Withholding override
  withholdingOverrideType: "none" | "percent" | "amount";
  withholdingOverridePercent: number | null;
  withholdingOverrideAmount: number | null;
  targetAnnualWithholding: number;
  isLoading: boolean;
}

const FILING_TO_KIND = (ft: FilingType): IncomeSourceBreakdown["kind"] => {
  if (ft === "w2" || ft === "scorp_w2") return "w2";
  if (ft === "1099_schedule_c" || ft === "k1_partnership" || ft === "scorp_distribution")
    return "business";
  return "other";
};

export function useTaxBreakdown(
  filterCompanyName?: string,
  mode: TaxBreakdownMode = "actual",
): TaxBreakdownResult {
  const { data: settings, isLoading: sLoading } = useTaxSettings();
  const { data: txs = [], isLoading: tLoading } = useTransactions();
  const { data: incomes = [], isLoading: iLoading } = useIncomeEntries();
  const { companies } = useCompanies();
  const { data: streams = [], isLoading: stLoading } = useProjectedStreams();
  const { data: bonuses = [], isLoading: bLoading } = useProjectedBonuses();
  const { data: overrides = [], isLoading: oLoading } = useStreamOverrides();
  const currentYear = new Date().getFullYear();
  const { data: mileageEntries = [] } = useMileageYTD(currentYear);
  const { data: homeOfficeDeductions = [], isLoading: hoLoading } = useHomeOfficeDeductions(currentYear);
  const { data: investmentEntries = [] } = useInvestmentIncomeEntries();

  // 🎯 SINGLE SOURCE OF TRUTH for all totals
  const {
    actualDebug,
    currentPaceDebug,
    forecastDebug,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
    isLoading: estLoading,
  } = useTaxEstimate();

  return useMemo(() => {
    const filingStatus: FilingStatus = (settings?.filingStatus as FilingStatus) ?? "single";

    const debug = mode === "forecast" ? forecastDebug : actualDebug;
    const estimate = mode === "forecast" ? forecastEstimate : actualEstimate;

    // Filter by company (only used when filterCompanyName is set — currently
    // never passed at call sites, but kept for future drilldown support).
    const matchCompany = (entity?: string | null) =>
      !filterCompanyName || (entity ?? "") === filterCompanyName;

    // ── Per-company source aggregation (display only, no tax math) ──
    interface CompanyAgg {
      companyId: string | null;
      name: string;
      filingType: FilingType;
      actualGross: number;
      plannedGross: number;
      preTax: number;
      retirement: number;
      healthcare: number;
      payrollHsa: number;
      withheld: number;
      stateWithheld: number;
      federalWithheld: number;
      plannedPreTax: number;
      plannedRetirement: number;
    }
    const companyAgg = new Map<string, CompanyAgg>();

    const normName = (s: string) => (s || "").trim().toLowerCase();
    // Resolve a stable companyId from any of: explicit id, name+type match,
    // or name-only match. Prevents the same entity (e.g. Vituity K-1) from
    // being keyed two different ways and rendering as duplicate cards.
    const resolveCompanyId = (name: string, ft: FilingType, companyId: string | null): string | null => {
      if (companyId) return companyId;
      if (!name) return null;
      const n = normName(name);
      const byNameAndType = companies.find(
        (c) => normName(c.name) === n && normalizeFilingType(c.companyType) === ft,
      );
      if (byNameAndType) return byNameAndType.id;
      const byName = companies.find((c) => normName(c.name) === n);
      return byName?.id ?? null;
    };
    // Build a stable key. If we resolved a real companyId use it; otherwise
    // fall back to normalized name + filing type so casing/whitespace can't
    // create duplicate buckets.
    const aggKeyFor = (name: string, ft: FilingType, companyId: string | null): string => {
      const resolved = resolveCompanyId(name, ft, companyId);
      return resolved || `name::${normName(name) || "unassigned"}::${ft}`;
    };

    const ensureAgg = (name: string, ft: FilingType, companyId: string | null = null): CompanyAgg => {
      const resolvedId = resolveCompanyId(name, ft, companyId);
      const key = aggKeyFor(name, ft, companyId);
      const existing = companyAgg.get(key) ?? {
        companyId: resolvedId, name, filingType: ft,
        actualGross: 0, plannedGross: 0,
        preTax: 0, retirement: 0, healthcare: 0, payrollHsa: 0,
        withheld: 0, stateWithheld: 0, federalWithheld: 0,
        plannedPreTax: 0, plannedRetirement: 0,
      };
      existing.companyId = existing.companyId || resolvedId;
      companyAgg.set(key, existing);
      return existing;
    };

    let plannedPreTaxTotal = 0;
    let plannedRetirementTotal = 0;

    for (const e of incomes) {
      if (!matchCompany(e.company)) continue;
      const status = ((e as any).status ?? "received") as string;
      const isReceived = status === "received";
      const company = (e as any).source_id ? companies.find((c) => c.id === (e as any).source_id) : undefined;
      const ft = normalizeFilingType(company?.companyType || e.income_type);
      const agg = ensureAgg(company?.name || e.company || "Unassigned", ft, company?.id || (e as any).source_id || null);

      if (isReceived) {
        agg.actualGross += Number(e.paycheck_amount) || 0;
        agg.preTax += Number(e.pre_tax_deductions) || 0;
        agg.retirement += Number(e.retirement_401k) || 0;
        agg.healthcare += Number((e as any).healthcare_deduction) || 0;
        // W-2 personal-income HSA is treated as Section 125 payroll HSA — see
        // useTaxEstimate line ~512. Track separately so we can subtract it
        // from FICA wages without double-counting the (Section 125) `preTax` bucket.
        agg.payrollHsa += Math.max(0, Number((e as any).hsa_contribution) || 0);
        // Canonical federal total via shared helper (handles taxes_withheld,
        // legacy federal_withholding-only rows, and split SS/Medicare).
        agg.withheld += getTotalFederalPaid(e as any);
        agg.federalWithheld += getTotalFederalPaid(e as any);
        agg.stateWithheld += Number((e as any).state_withholding) || 0;
      } else if (mode === "forecast") {
        const gross = Number(e.paycheck_amount) || 0;
        const preTax = Number(e.pre_tax_deductions) || 0;
        const retirement = Number(e.retirement_401k) || 0;
        agg.plannedGross += gross;
        agg.plannedPreTax += preTax;
        agg.plannedRetirement += retirement;
        agg.preTax += preTax;
        agg.retirement += retirement;
        agg.healthcare += Number((e as any).healthcare_deduction) || 0;
        plannedPreTaxTotal += preTax;
        plannedRetirementTotal += retirement;
      }
    }

    // Per-stream count of "active" planned paychecks, used below to project
    // planned business expenses (forecast_expense_per_period × active count)
    // into each linked company's expense bucket so include-planned Tax
    // Breakdown reflects expenses the user entered on K-1 / 1099 streams.
    const activePaychecksByStream = new Map<string, number>();
    if (mode === "forecast") {
      const paychecks = generateProjectedPaychecks(streams, bonuses, incomes, overrides);
      const activePlanned = paychecks.filter((p) => p.matchStatus === "active");
      for (const p of activePlanned) {
        const company = p.label.split(" (")[0];
        const stream = streams.find((s) => s.id === p.streamId);
        const ft = normalizeFilingType(stream?.company_type || "1099");
        const companyName = stream?.company || company || "Planned";
        if (!matchCompany(companyName)) continue;
        const agg = ensureAgg(companyName, ft, (stream as any)?.source_id || null);
        agg.plannedGross += p.grossAmount;
        agg.plannedPreTax += p.preTaxDeductions;
        agg.plannedRetirement += p.retirement401k;
        agg.preTax += p.preTaxDeductions;
        agg.retirement += p.retirement401k;
        agg.healthcare += p.healthcareDeduction || 0;
        agg.withheld += p.taxesWithheld;
        plannedPreTaxTotal += p.preTaxDeductions;
        plannedRetirementTotal += p.retirement401k;
        if (p.type === "paycheck") {
          activePaychecksByStream.set(p.streamId, (activePaychecksByStream.get(p.streamId) || 0) + 1);
        }
      }
    }

    // ── Business income from transactions (canonical source) ─────────────
    // The tax engine derives business gross from `transactions` where
    // transaction_type === "income" for business-filing companies (1099 /
    // K-1 / S-Corp distribution). income_entries only sometimes exist for
    // these (paycheck-style enrichment). Without this loop a fresh 1099
    // user with revenue transactions but no income_entries would not see
    // their business as an income source on Tax Breakdown even though the
    // tax math includes the profit. Dedupe via `linked_transaction_id`.
    const txIdsCoveredByIncomes = new Set<string>(
      incomes
        .map((e) => (e as any).linked_transaction_id)
        .filter((id): id is string => Boolean(id)),
    );
    for (const tx of txs) {
      if ((tx as any).transaction_type !== "income") continue;
      if (isExcludedFromBusiness(tx as any)) continue;
      if (txIdsCoveredByIncomes.has(tx.id)) continue;
      if (!matchCompany(tx.entity)) continue;
      const company = (tx as any).source_id
        ? companies.find((c) => c.id === (tx as any).source_id)
        : companies.find((c) => normName(c.name) === normName(tx.entity || ""));
      const ft = normalizeFilingType(company?.companyType || (tx as any).company_type);
      const kind = FILING_TO_KIND(ft);
      // Only canonical-source business kinds here; W-2 is already covered
      // by income_entries above (paychecks).
      if (kind !== "business") continue;
      const name = company?.name || tx.entity || "Unassigned";
      const agg = ensureAgg(name, ft, company?.id || (tx as any).source_id || null);
      agg.actualGross += Math.abs(Number(tx.amount) || 0);
    }

    // Expense aggregation per company + cap gains
    interface ExpenseAgg {
      total: number;
      byCategory: Map<ScheduleCCategory, { total: number; count: number }>;
      txCount: number;
    }
    const expensesByCompany = new Map<string, ExpenseAgg>();
    let capGainsShort = 0;
    let capGainsLong = 0;
    let capGainsLosses = 0;

    for (const tx of txs) {
      if (!matchCompany(tx.entity)) continue;
      const txType = (tx as any).transaction_type as string;
      // CANONICAL exclusion: covers transfer, excluded_from_reports, and
      // Personal-category rows. See src/lib/businessExclusion.ts.
      if (isExcludedFromBusiness(tx as any)) continue;

      if (txType === "expense") {
        const knownCompany = tx.source_id
          ? companies.find((c) => c.id === tx.source_id)
          : companies.filter((c) => c.name === tx.entity).length === 1
            ? companies.find((c) => c.name === tx.entity)
            : undefined;
        if (!knownCompany) continue;
        const key = knownCompany.id;
        const amt = Math.abs(Number(tx.amount) || 0);
        const cat: ScheduleCCategory =
          ((tx as any).schedule_c_category as ScheduleCCategory) ||
          mapToScheduleC(tx.category);
        const agg = expensesByCompany.get(key) ?? {
          total: 0, byCategory: new Map(), txCount: 0,
        };
        agg.total += amt;
        agg.txCount += 1;
        const catAgg = agg.byCategory.get(cat) ?? { total: 0, count: 0 };
        catAgg.total += amt;
        catAgg.count += 1;
        agg.byCategory.set(cat, catAgg);
        expensesByCompany.set(key, agg);
      } else if (txType === "capital_gain" || txType === "stock") {
        const amt = Number(tx.amount) || 0;
        const isLong = /long[-\s]?term|ltcg/i.test((tx.notes || "") + " " + (tx.category || ""));
        if (amt < 0) capGainsLosses += Math.abs(amt);
        else if (isLong) capGainsLong += amt;
        else capGainsShort += amt;
      }
    }

    // ── Mileage deductions per company (folded into Schedule C "car_truck") ──
    // Each mileage entry's deductible amount = miles × IRS rate flows into the
    // associated company's expenses, profit math, and Schedule C output.
    // Entries with company_id = NULL are treated as Unassigned and intentionally
    // excluded from any per-company total (no double counting).
    for (const m of mileageEntries) {
      if (!m.company_id) continue;
      const company = companies.find((c) => c.id === m.company_id);
      if (!company) continue; // company deleted → skip
      if (!matchCompany(company.name)) continue;
      const dollars = Number(m.miles) * getIrsMileageRate(m.year);
      if (dollars <= 0) continue;
      const agg = expensesByCompany.get(company.id) ?? {
        total: 0, byCategory: new Map(), txCount: 0,
      };
      agg.total += dollars;
      const catAgg = agg.byCategory.get("car_truck") ?? { total: 0, count: 0 };
      catAgg.total += dollars;
      catAgg.count += 1;
      agg.byCategory.set("car_truck", catAgg);
      expensesByCompany.set(company.id, agg);
    }
    for (const deduction of homeOfficeDeductions) {
      if (!deduction.company_id || !deduction.include_in_tax_calculation || deduction.status !== "active") continue;
      const company = companies.find((c) => c.id === deduction.company_id);
      if (!company || !matchCompany(company.name)) continue;
      const dollars = Math.max(0, Number(deduction.allowed_amount || 0));
      if (dollars <= 0) continue;
      const agg = expensesByCompany.get(company.id) ?? { total: 0, byCategory: new Map(), txCount: 0 };
      agg.total += dollars;
      const catAgg = agg.byCategory.get("office") ?? { total: 0, count: 0 };
      catAgg.total += dollars;
      catAgg.count += 1;
      agg.byCategory.set("office", catAgg);
      expensesByCompany.set(company.id, agg);
    }

    // ── Planned business expenses from Income Planner (forecast mode only) ──
    // Streams allow users to enter `forecast_expense_per_period` for K-1 /
    // 1099 / Schedule-C income. Without this projection the Tax Breakdown
    // shows planned revenue but ignores planned expenses, so include-planned
    // business profit overstates by the planned expense amount.
    // Pure helper (`aggregatePlannedBusinessExpenses`) is unit tested.
    if (mode === "forecast") {
      const plannedExpenseBuckets = aggregatePlannedBusinessExpenses(
        streams.map((s) => ({
          id: s.id,
          company: s.company,
          company_type: s.company_type,
          source_id: s.source_id ?? null,
          is_active: s.is_active,
          forecast_expense_per_period: Number(s.forecast_expense_per_period) || 0,
        })),
        Array.from(activePaychecksByStream.entries()).flatMap(([streamId, count]) =>
          Array.from({ length: count }, () => ({
            streamId,
            type: "paycheck" as const,
            matchStatus: "active",
          })),
        ),
        companies.map((c) => ({ id: c.id, name: c.name })),
      );
      for (const bucket of plannedExpenseBuckets.values()) {
        if (!matchCompany(bucket.companyName)) continue;
        const expenseKey =
          bucket.companyId || aggKeyFor(bucket.companyName, bucket.filingType, null);
        const agg = expensesByCompany.get(expenseKey) ?? {
          total: 0,
          byCategory: new Map(),
          txCount: 0,
        };
        agg.total += bucket.total;
        const catAgg = agg.byCategory.get("other") ?? { total: 0, count: 0 };
        catAgg.total += bucket.total;
        catAgg.count += 1;
        agg.byCategory.set("other", catAgg);
        expensesByCompany.set(expenseKey, agg);
        // Ensure a CompanyAgg exists so the planned-only K-1 stream still
        // renders a source card with the planned expenses visible (matters
        // when there are no actual transactions yet for the entity).
        ensureAgg(bucket.companyName, bucket.filingType, bucket.companyId);
      }
    }

    const sources: IncomeSourceBreakdown[] = [];
    let totalBusinessRevenue = 0;
    let totalBusinessExpenses = 0;
    let totalBusinessProfit = 0;
    let totalW2Income = 0;
    let totalOtherIncome = 0;
    let plannedBusinessRevenue = 0;
    let plannedW2Income = 0;
    let plannedOtherIncome = 0;
    let actualBusinessRevenue = 0;
    let actualW2Income = 0;
    let actualOtherIncome = 0;

    for (const agg of companyAgg.values()) {
      const kind = FILING_TO_KIND(agg.filingType);
      const totalGross = agg.actualGross + agg.plannedGross;

      if (kind === "w2") {
        const taxableWages = Math.max(0, totalGross - agg.preTax - agg.retirement);
        totalW2Income += totalGross;
        actualW2Income += agg.actualGross;
        plannedW2Income += agg.plannedGross;
        sources.push({
          kind: "w2",
          companyName: agg.name,
          grossWages: totalGross,
          actualGrossWages: agg.actualGross,
          plannedGrossWages: agg.plannedGross,
          federalWithheld: agg.federalWithheld,
          stateWithheld: agg.stateWithheld,
          preTaxDeductions: agg.preTax,
          retirement401k: agg.retirement,
          taxableWages,
          payrollHsa: agg.payrollHsa,
          section125Deductions: agg.preTax + agg.payrollHsa,
        });
      } else if (kind === "business") {
        const companyId = agg.companyId ?? companies.find((c) => c.name === agg.name && c.companyType === agg.filingType)?.id ?? null;
        const exp = companyId ? expensesByCompany.get(companyId) : expensesByCompany.get(aggKeyFor(agg.name, agg.filingType, null));
        const expenses = exp?.total ?? 0;
        const profit = totalGross - expenses;
        const actualProfit = agg.actualGross - expenses;
        const plannedProfit = agg.plannedGross;
        totalBusinessRevenue += totalGross;
        actualBusinessRevenue += agg.actualGross;
        plannedBusinessRevenue += agg.plannedGross;
        totalBusinessExpenses += expenses;
        totalBusinessProfit += profit;
        const expenseCategories: CategoryBreakdown[] = exp
          ? Array.from(exp.byCategory.entries())
              .map(([category, v]) => ({ category, total: v.total, count: v.count }))
              .sort((a, b) => b.total - a.total)
          : [];
        sources.push({
          kind: "business",
          companyId, companyName: agg.name,
          filingType: agg.filingType,
          revenue: totalGross, actualRevenue: agg.actualGross, plannedRevenue: agg.plannedGross,
          expenses, profit, actualProfit, plannedProfit,
          expenseCategories, expenseTxCount: exp?.txCount ?? 0,
        });
      } else {
        totalOtherIncome += totalGross;
        actualOtherIncome += agg.actualGross;
        plannedOtherIncome += agg.plannedGross;
        sources.push({
          kind: "other",
          companyName: agg.name,
          filingType: agg.filingType,
          grossAmount: totalGross, actualGrossAmount: agg.actualGross, plannedGrossAmount: agg.plannedGross,
          taxableAmount: Math.max(0, totalGross - agg.preTax - agg.retirement),
        });
      }
    }

    // ── Defensive dedupe: merge any business/other sources that share the
    // same entity (companyId, or normalized name + filingType). Guards
    // against any upstream path that might still emit two summaries for the
    // same entity (e.g. a K-1 entity like "Vituity" appearing twice).
    const mergedSources: IncomeSourceBreakdown[] = [];
    const sourceIndex = new Map<string, number>();
    const dedupeKey = (s: IncomeSourceBreakdown): string | null => {
      if (s.kind === "business") {
        return s.companyId
          ? `business::id::${s.companyId}`
          : `business::name::${normName(s.companyName)}::${s.filingType}`;
      }
      if (s.kind === "other") {
        return `other::name::${normName(s.companyName)}::${s.filingType}`;
      }
      if (s.kind === "w2") {
        return `w2::name::${normName(s.companyName)}`;
      }
      return null;
    };
    for (const s of sources) {
      const key = dedupeKey(s);
      if (!key) { mergedSources.push(s); continue; }
      const existingIdx = sourceIndex.get(key);
      if (existingIdx === undefined) {
        sourceIndex.set(key, mergedSources.length);
        mergedSources.push(s);
        continue;
      }
      const prev = mergedSources[existingIdx];
      if (prev.kind === "business" && s.kind === "business") {
        // Merge expense categories by category key.
        const catMap = new Map<ScheduleCCategory, CategoryBreakdown>();
        for (const c of prev.expenseCategories) catMap.set(c.category, { ...c });
        for (const c of s.expenseCategories) {
          const ex = catMap.get(c.category);
          if (ex) { ex.total += c.total; ex.count += c.count; }
          else catMap.set(c.category, { ...c });
        }
        const expenses = Math.max(prev.expenses, s.expenses); // expenses are looked up by companyId — same entity = same total, take max to avoid double count
        const actualRevenue = prev.actualRevenue + s.actualRevenue;
        const plannedRevenue = prev.plannedRevenue + s.plannedRevenue;
        const revenue = actualRevenue + plannedRevenue;
        mergedSources[existingIdx] = {
          ...prev,
          companyId: prev.companyId || s.companyId,
          actualRevenue, plannedRevenue, revenue,
          expenses,
          profit: revenue - expenses,
          actualProfit: actualRevenue - expenses,
          plannedProfit: plannedRevenue,
          expenseCategories: Array.from(catMap.values()).sort((a, b) => b.total - a.total),
          expenseTxCount: Math.max(prev.expenseTxCount, s.expenseTxCount),
        };
      } else if (prev.kind === "other" && s.kind === "other") {
        const actualGrossAmount = prev.actualGrossAmount + s.actualGrossAmount;
        const plannedGrossAmount = prev.plannedGrossAmount + s.plannedGrossAmount;
        mergedSources[existingIdx] = {
          ...prev,
          actualGrossAmount, plannedGrossAmount,
          grossAmount: actualGrossAmount + plannedGrossAmount,
          taxableAmount: prev.taxableAmount + s.taxableAmount,
        };
      } else if (prev.kind === "w2" && s.kind === "w2") {
        const actualGrossWages = prev.actualGrossWages + s.actualGrossWages;
        const plannedGrossWages = prev.plannedGrossWages + s.plannedGrossWages;
        mergedSources[existingIdx] = {
          ...prev,
          actualGrossWages, plannedGrossWages,
          grossWages: actualGrossWages + plannedGrossWages,
          federalWithheld: prev.federalWithheld + s.federalWithheld,
          stateWithheld: prev.stateWithheld + s.stateWithheld,
          preTaxDeductions: prev.preTaxDeductions + s.preTaxDeductions,
          retirement401k: prev.retirement401k + s.retirement401k,
          taxableWages: prev.taxableWages + s.taxableWages,
        };
      }
    }
    if (import.meta.env.DEV && mergedSources.length !== sources.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useTaxBreakdown] Merged ${sources.length - mergedSources.length} duplicate income source card(s) in mode=${mode}`,
      );
    }

    // ── Developer debug: log resolved companyId, dedupe key, merge counts
    // for each business/K-1 entity. Toggle via the Tax Overview page or
    // localStorage["debug:taxBreakdown"] = "1".
    {
      const mergeCounts = new Map<string, number>();
      for (const s of sources) {
        const k = dedupeKey(s);
        if (!k) continue;
        mergeCounts.set(k, (mergeCounts.get(k) ?? 0) + 1);
      }
      const debugRows = mergedSources
        .filter((s): s is Extract<IncomeSourceBreakdown, { kind: "business" }> => s.kind === "business")
        .map((s) => {
          const k = dedupeKey(s) ?? "";
          return {
            companyName: s.companyName,
            filingType: s.filingType,
            resolvedCompanyId: s.companyId ?? null,
            dedupeKey: k,
            mergedFrom: mergeCounts.get(k) ?? 1,
            revenue: s.revenue,
            expenses: s.expenses,
            profit: s.profit,
          };
        });
      logTaxBreakdown({
        mode,
        rows: debugRows,
        totalSourcesBeforeMerge: sources.length,
        totalSourcesAfterMerge: mergedSources.length,
      });
    }

    sources.length = 0;
    sources.push(...mergedSources);

    // Fold investment_income_entries into capital gains aggregation so the
    // Tax Breakdown display reflects the same investment data the engine
    // already includes in taxable income (was previously txs-only and missed
    // entries created via the Investments page).
    const invBuckets = aggregateInvestmentTaxBuckets(investmentEntries);
    const invShortGain = Math.max(0, invBuckets.shortTermSales);
    const invLongGain = Math.max(0, invBuckets.longTermSales);
    const invLosses =
      Math.max(0, -Math.min(0, invBuckets.shortTermSales)) +
      Math.max(0, -Math.min(0, invBuckets.longTermSales));
    const totalShortTermGains = capGainsShort + invShortGain;
    const totalLongTermGains = capGainsLong + invLongGain;
    const totalLosses = capGainsLosses + invLosses;
    const totalDividends = invBuckets.dividends;
    if (
      totalShortTermGains > 0 ||
      totalLongTermGains > 0 ||
      totalLosses > 0 ||
      totalDividends > 0
    ) {
      sources.push({
        kind: "capital_gains",
        source: "Investment accounts",
        shortTerm: totalShortTermGains,
        longTerm: totalLongTermGains,
        losses: totalLosses,
        net: totalShortTermGains + totalLongTermGains - totalLosses + totalDividends,
        dividends: totalDividends,
        qualifiedDividends: invBuckets.qualifiedDividends,
        nonQualifiedDividends: invBuckets.nonQualifiedDividends,
      });
    }


    // ── ENGINE-DRIVEN TOTALS (single source of truth) ──
    // If the engine isn't ready yet, return zeroed loading state.
    const isLoading = sLoading || tLoading || iLoading || stLoading || bLoading || oLoading || estLoading || hoLoading;
    const standardDeduction = settings?.standardDeductionOverride ?? 0;
    const itemizedDeduction = Number(settings?.itemizedDeductionAmount) || 0;

    if (!debug || !estimate) {
      const empty: BracketCalc = { total: 0, lines: [] };
      return {
        mode, filingStatus, sources,
        totalBusinessRevenue, totalBusinessExpenses, totalBusinessProfit,
        totalW2Income, totalShortTermGains, totalLongTermGains, totalOtherIncome,
        totalGrossIncome: 0, totalReturnIncomeBeforeAdjustments: 0,
        w2PreTaxDeductions: 0, w2TaxableIncomeBase: 0,
        w2PayrollHsa: 0, w2Section125Deductions: 0,
        totalDeductions: 0,
        preTaxDeductions: 0, retirement401k: 0, healthInsuranceDeduction: 0,
        actualHealthInsuranceDeduction: 0, projectedHealthInsuranceDeduction: 0,
        deductionSourceBreakdown: "",
        agi: 0, standardDeduction, itemizedDeduction,
        deductionApplied: 0, deductionType: "standard",
        seDeductibleHalf: 0,
        plannedBusinessRevenue, plannedW2Income, plannedOtherIncome,
        plannedPreTax: plannedPreTaxTotal, plannedRetirement: plannedRetirementTotal,
        plannedTotalIncome: plannedBusinessRevenue + plannedW2Income + plannedOtherIncome,
        actualBusinessRevenue, actualW2Income, actualOtherIncome,
        taxableOrdinaryIncome: 0, taxableLTCG: 0, totalTaxableIncome: 0,
        ordinaryBracketCalc: empty, ltcgBracketCalc: empty,
        seTax: { netSEIncome: 0, seBase: 0, ssTax: 0, medicareTax: 0, additionalMedicare: 0, total: 0, deductibleHalf: 0 },
        federalTaxBeforeCredits: 0, dependentCredits: 0, taxCredits: 0, federalTaxAfterCredits: 0,
        qualifyingChildrenCount: 0, otherDependentsCount: 0,
        totalEstimatedTax: 0, personalStateTax: 0, businessStateTax: 0, stateTax: 0,
        federalWithheldPaid: 0, stateWithheldPaid: 0, estimatedPaymentsMade: 0,
        countedCreditsTotal: 0, remainingTaxDue: 0,
        effectiveRate: 0, marginalRate: 0,
        withholdingOverrideType: "none",
        withholdingOverridePercent: null, withholdingOverrideAmount: null,
        targetAnnualWithholding: 0,
        isLoading: true,
      };
    }

    // Engine values (these are THE truth — used by Tax Overview too)
    const totalGrossIncome = debug.totalGrossIncome;
    const totalReturnIncomeBeforeAdjustments = debug.totalReturnIncomeBeforeAdjustments;
    const w2PreTaxDeductions = debug.w2PreTaxDeductions;
    const w2TaxableIncomeBase = debug.w2TaxableIncomeBase;
    const agi = debug.agi;
    const taxableIncome = debug.totalTaxableIncome;
    const federalTaxBeforeCredits = debug.federalTaxBeforeCredits;
    const dependentCredits = debug.taxCredits;
    const federalTaxAfterCredits = debug.federalIncomeTax; // engine's after-credits federal
    const totalEstimatedTax = debug.totalEstimatedTax;
    const stateTax = debug.stateTax;
    const personalStateTax = debug.personalStateTax;
    const businessStateTax = debug.businessStateTax;
    const seTaxFromEngine = estimate.seTax;
    const seDeductibleHalf = debug.halfSETaxDeduction;
    const preTaxFromEngine = debug.preTaxDeductions;
    const retirementFromEngine = debug.retirementContributions;
    const healthInsuranceDeduction = debug.healthInsuranceDeduction;
    const actualHealthInsuranceDeduction = debug.actualHealthInsuranceDeduction;
    const projectedHealthInsuranceDeduction = debug.projectedHealthInsuranceDeduction;
    const deductionSourceBreakdown = debug.deductionSourceBreakdown;
    const deductionApplied = debug.deductionApplied;
    const deductionType = debug.deductionType;
    const totalDeductions = debug.totalDeductions;

    // ── Bracket display (for MathAccordion section B) ──
    // Drive from ENGINE's resolved taxable income so this display always
    // ties to the engine's federalTaxBeforeCredits. We split LTCG vs ordinary
    // using local cap-gains aggregation only for VISUAL distinction; the
    // engine's federal-tax-before-credits is authoritative.
    const taxableLTCG = Math.max(0, totalLongTermGains);
    const taxableOrdinaryIncome = Math.max(0, taxableIncome - taxableLTCG);
    const ordBrackets = ORDINARY_BRACKETS[filingStatus];
    const ordinaryBracketCalc = calcBracketTax(taxableOrdinaryIncome, ordBrackets);
    // LTCG line: residual = federalTaxBeforeCredits − ordinary bracket total.
    const ltcgBracketCalc: BracketCalc = {
      total: Math.max(0, federalTaxBeforeCredits - ordinaryBracketCalc.total),
      lines: [],
    };

    // ── DEV-ONLY GUARDRAIL: confirm bracket recalculation matches engine ──
    if (typeof window !== "undefined" && import.meta.env?.MODE !== "production") {
      const sumBracketTax = ordinaryBracketCalc.total + ltcgBracketCalc.total;
      if (Math.abs(sumBracketTax - federalTaxBeforeCredits) > 1) {
        // eslint-disable-next-line no-console
        console.error(
          "[useTaxBreakdown] Bracket display total != engine federalTaxBeforeCredits",
          { sumBracketTax, engineValue: federalTaxBeforeCredits, mode },
        );
      }
      // Identity: federalTaxAfterCredits === federalTaxBeforeCredits − credits
      const expectedAfter = Math.max(0, federalTaxBeforeCredits - dependentCredits);
      if (Math.abs(federalTaxAfterCredits - expectedAfter) > 1) {
        // eslint-disable-next-line no-console
        console.error(
          "[useTaxBreakdown] federalTaxAfterCredits != before − credits",
          { federalTaxAfterCredits, expectedAfter, federalTaxBeforeCredits, dependentCredits },
        );
      }
      // Identity: remainingTaxDue === totalEstimatedTax − countedCreditsTotal
      const expectedRemaining = Math.max(0, totalEstimatedTax - debug.countedCreditsTotal);
      if (Math.abs(debug.remainingTaxDue - expectedRemaining) > 1) {
        // eslint-disable-next-line no-console
        console.error(
          "[useTaxBreakdown] remainingTaxDue != totalEstimatedTax − countedCreditsTotal",
          { remainingTaxDue: debug.remainingTaxDue, expectedRemaining, totalEstimatedTax, countedCreditsTotal: debug.countedCreditsTotal },
        );
      }
    }

    const profile = getSelectedWithholdingProfileRate({
      taxSettings: settings,
      actualEstimate,
      currentPaceEstimate,
      forecastEstimate,
    });
    // Shared display helper — keeps Tax Overview and Tax Breakdown identical
    // for the same user and same selected mode (Actual Only vs Planned).
    const effectiveRate = getDisplayedEffectiveRatePct({
      taxSettings: settings,
      modeEstimate: estimate,
      profile,
    }) / 100;
    const marginalRate = getMarginalRate(taxableOrdinaryIncome, ordBrackets);

    // Withholding override → annual target (planning layer only)
    const withholdingOverrideType = (settings?.withholdingOverrideType as "none" | "percent" | "amount") ?? "none";
    const withholdingOverridePercent = settings?.withholdingOverridePercent ?? null;
    const withholdingOverrideAmount = settings?.withholdingOverrideAmount ?? null;
    let targetAnnualWithholding = totalEstimatedTax;
    if (withholdingOverrideType === "percent" && withholdingOverridePercent != null) {
      targetAnnualWithholding = totalGrossIncome * (withholdingOverridePercent / 100);
    } else if (withholdingOverrideType === "amount" && withholdingOverrideAmount != null) {
      targetAnnualWithholding = withholdingOverrideAmount * 12;
    }

    // Aggregate Section 125 totals from per-source W-2 buckets. Consumers
    // (MathAccordion, engine hookup) use these to compute FICA wages.
    const w2PayrollHsaTotal = sources.reduce(
      (sum, s) => (s.kind === "w2" ? sum + (s.payrollHsa || 0) : sum),
      0,
    );
    const w2Section125DeductionsTotal = sources.reduce(
      (sum, s) => (s.kind === "w2" ? sum + (s.section125Deductions || 0) : sum),
      0,
    );


    return {
      mode, filingStatus, sources,
      totalBusinessRevenue, totalBusinessExpenses, totalBusinessProfit,
      totalW2Income, totalShortTermGains, totalLongTermGains, totalOtherIncome,
      totalGrossIncome, totalReturnIncomeBeforeAdjustments,
      w2PreTaxDeductions, w2TaxableIncomeBase,
      w2PayrollHsa: w2PayrollHsaTotal,
      w2Section125Deductions: w2Section125DeductionsTotal,
      totalDeductions,
      preTaxDeductions: preTaxFromEngine,
      retirement401k: retirementFromEngine,
      healthInsuranceDeduction, actualHealthInsuranceDeduction, projectedHealthInsuranceDeduction,
      deductionSourceBreakdown,
      agi, standardDeduction, itemizedDeduction,
      deductionApplied, deductionType,
      seDeductibleHalf,
      plannedBusinessRevenue, plannedW2Income, plannedOtherIncome,
      plannedPreTax: plannedPreTaxTotal, plannedRetirement: plannedRetirementTotal,
      plannedTotalIncome: plannedBusinessRevenue + plannedW2Income + plannedOtherIncome,
      actualBusinessRevenue, actualW2Income, actualOtherIncome,
      taxableOrdinaryIncome, taxableLTCG, totalTaxableIncome: taxableIncome,
      ordinaryBracketCalc, ltcgBracketCalc,
      seTax: {
        netSEIncome: Math.max(0, seTaxFromEngine?.netSEIncome ?? estimate.seIncome),
        seBase: Math.max(0, seTaxFromEngine?.seBase ?? debug.seTaxableBase),
        ssTax: seTaxFromEngine?.ssTax ?? debug.seSocialSecurityTax,
        medicareTax: seTaxFromEngine?.medicareTax ?? debug.seMedicareTax,
        additionalMedicare: seTaxFromEngine?.additionalMedicare ?? debug.seAdditionalMedicareTax,
        total: debug.selfEmploymentTax,
        deductibleHalf: seDeductibleHalf,
      },
      federalTaxBeforeCredits,
      dependentCredits,
      taxCredits: dependentCredits,
      federalTaxAfterCredits,
      qualifyingChildrenCount: Number(settings?.qualifyingChildrenCount) || 0,
      otherDependentsCount: Number(settings?.otherDependentsCount) || 0,
      totalEstimatedTax,
      personalStateTax, businessStateTax, stateTax,
      federalWithheldPaid: debug.federalWithheld,
      stateWithheldPaid: debug.stateWithheld,
      estimatedPaymentsMade: debug.estimatedPaymentsMade,
      countedCreditsTotal: debug.countedCreditsTotal,
      remainingTaxDue: debug.remainingTaxDue,
      effectiveRate, marginalRate,
      withholdingOverrideType, withholdingOverridePercent, withholdingOverrideAmount,
      targetAnnualWithholding,
      isLoading,
    };
  }, [settings, txs, incomes, companies, streams, bonuses, overrides, mileageEntries, homeOfficeDeductions, investmentEntries, filterCompanyName, mode,
      sLoading, tLoading, iLoading, stLoading, bLoading, oLoading, estLoading, hoLoading,
      actualDebug, currentPaceDebug, forecastDebug, actualEstimate, currentPaceEstimate, forecastEstimate]);
}
