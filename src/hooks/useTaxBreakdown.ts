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
import { useMileageYTD, IRS_MILEAGE_RATE } from "@/hooks/useMileage";
import { normalizeFilingType, type FilingType } from "@/lib/filingTypes";
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";
import {
  ORDINARY_BRACKETS_2025,
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
}

export interface CapGainsBreakdown {
  kind: "capital_gains";
  source: string;
  shortTerm: number;
  longTerm: number;
  losses: number;
  net: number;
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
  totalDeductions: number;
  preTaxDeductions: number;
  retirement401k: number;
  healthInsuranceDeduction: number;
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

  // 🎯 SINGLE SOURCE OF TRUTH for all totals
  const {
    actualDebug,
    forecastDebug,
    actualEstimate,
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
      withheld: number;
      stateWithheld: number;
      federalWithheld: number;
      plannedPreTax: number;
      plannedRetirement: number;
    }
    const companyAgg = new Map<string, CompanyAgg>();

    const ensureAgg = (name: string, ft: FilingType, companyId: string | null = null): CompanyAgg => {
      const key = companyId || `${name}::${ft}`;
      const existing = companyAgg.get(key) ?? {
        companyId, name, filingType: ft,
        actualGross: 0, plannedGross: 0,
        preTax: 0, retirement: 0, healthcare: 0,
        withheld: 0, stateWithheld: 0, federalWithheld: 0,
        plannedPreTax: 0, plannedRetirement: 0,
      };
      existing.companyId = existing.companyId || companyId;
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
      }
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
        const company = tx.entity || "Unassigned";
        const knownCompany = companies.find((c) => c.name === company);
        if (!knownCompany) continue;
        const amt = Math.abs(Number(tx.amount) || 0);
        const cat: ScheduleCCategory =
          ((tx as any).schedule_c_category as ScheduleCCategory) ||
          mapToScheduleC(tx.category);
        const agg = expensesByCompany.get(company) ?? {
          total: 0, byCategory: new Map(), txCount: 0,
        };
        agg.total += amt;
        agg.txCount += 1;
        const catAgg = agg.byCategory.get(cat) ?? { total: 0, count: 0 };
        catAgg.total += amt;
        catAgg.count += 1;
        agg.byCategory.set(cat, catAgg);
        expensesByCompany.set(company, agg);
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
      const dollars = Number(m.miles) * IRS_MILEAGE_RATE;
      if (dollars <= 0) continue;
      const agg = expensesByCompany.get(company.name) ?? {
        total: 0, byCategory: new Map(), txCount: 0,
      };
      agg.total += dollars;
      const catAgg = agg.byCategory.get("car_truck") ?? { total: 0, count: 0 };
      catAgg.total += dollars;
      catAgg.count += 1;
      agg.byCategory.set("car_truck", catAgg);
      expensesByCompany.set(company.name, agg);
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
        });
      } else if (kind === "business") {
        const exp = expensesByCompany.get(agg.name);
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
        const companyId = companies.find((c) => c.name === agg.name)?.id ?? null;
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

    const totalShortTermGains = capGainsShort;
    const totalLongTermGains = capGainsLong;
    if (totalShortTermGains > 0 || totalLongTermGains > 0 || capGainsLosses > 0) {
      sources.push({
        kind: "capital_gains",
        source: "Investment accounts",
        shortTerm: totalShortTermGains,
        longTerm: totalLongTermGains,
        losses: capGainsLosses,
        net: totalShortTermGains + totalLongTermGains - capGainsLosses,
      });
    }

    // ── ENGINE-DRIVEN TOTALS (single source of truth) ──
    // If the engine isn't ready yet, return zeroed loading state.
    const isLoading = sLoading || tLoading || iLoading || stLoading || bLoading || oLoading || estLoading;
    const standardDeduction = settings?.standardDeductionOverride ?? 0;
    const itemizedDeduction = Number(settings?.itemizedDeductionAmount) || 0;

    if (!debug || !estimate) {
      const empty: BracketCalc = { total: 0, lines: [] };
      return {
        mode, filingStatus, sources,
        totalBusinessRevenue, totalBusinessExpenses, totalBusinessProfit,
        totalW2Income, totalShortTermGains, totalLongTermGains, totalOtherIncome,
        totalGrossIncome: 0, totalDeductions: 0,
        preTaxDeductions: 0, retirement401k: 0, healthInsuranceDeduction: 0,
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
    const ordBrackets = ORDINARY_BRACKETS_2025[filingStatus];
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
      forecastEstimate,
    });
    const effectiveRate = ((settings?.withholdingMethod === "flat_estimate" ? profile.federalProfileRate : profile.canonicalEffectiveTaxRate) || 0) / 100;
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

    return {
      mode, filingStatus, sources,
      totalBusinessRevenue, totalBusinessExpenses, totalBusinessProfit,
      totalW2Income, totalShortTermGains, totalLongTermGains, totalOtherIncome,
      totalGrossIncome, totalDeductions,
      preTaxDeductions: preTaxFromEngine,
      retirement401k: retirementFromEngine,
      healthInsuranceDeduction,
      agi, standardDeduction, itemizedDeduction,
      deductionApplied, deductionType,
      seDeductibleHalf,
      plannedBusinessRevenue, plannedW2Income, plannedOtherIncome,
      plannedPreTax: plannedPreTaxTotal, plannedRetirement: plannedRetirementTotal,
      plannedTotalIncome: plannedBusinessRevenue + plannedW2Income + plannedOtherIncome,
      actualBusinessRevenue, actualW2Income, actualOtherIncome,
      taxableOrdinaryIncome, taxableLTCG, totalTaxableIncome: taxableIncome,
      ordinaryBracketCalc, ltcgBracketCalc,
      seTax: (() => {
        const netSEIncome = Math.max(0, estimate.seIncome - estimate.businessExpenses - (estimate as any).mileageDeduction);
        const seBase = netSEIncome * 0.9235;
        return {
          netSEIncome, seBase,
          ssTax: seTaxFromEngine?.ssTax ?? 0,
          medicareTax: seTaxFromEngine?.medicareTax ?? 0,
          additionalMedicare: seTaxFromEngine?.additionalMedicare ?? 0,
          total: debug.selfEmploymentTax,
          deductibleHalf: seDeductibleHalf,
        };
      })(),
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
  }, [settings, txs, incomes, companies, streams, bonuses, overrides, mileageEntries, filterCompanyName, mode,
      sLoading, tLoading, iLoading, stLoading, bLoading, oLoading, estLoading,
      actualDebug, forecastDebug, actualEstimate, forecastEstimate]);
}
