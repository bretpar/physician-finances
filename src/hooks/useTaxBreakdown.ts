import { useMemo } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useCompanies } from "@/contexts/CompanyContext";
import {
  useProjectedStreams,
  useProjectedBonuses,
  useStreamOverrides,
  generateProjectedPaychecks,
} from "@/hooks/useProjectedIncome";
import { mapToScheduleC, type ScheduleCCategory } from "@/lib/scheduleC";
import { normalizeFilingType, type FilingType } from "@/lib/filingTypes";
import {
  ORDINARY_BRACKETS_2025,
  LTCG_BRACKETS_2025,
  STANDARD_DEDUCTION_2025,
  calcBracketTax,
  calcSETax,
  getMarginalRate,
  type FilingStatus,
  type BracketCalc,
  type SETaxCalc,
} from "@/lib/taxBrackets";
import { calculateDependentCredits, calculatePersonalStateTax, calculateBusinessStateTax } from "@/lib/taxEngine";

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
  revenue: number;          // actual + planned (total used in calc)
  actualRevenue: number;
  plannedRevenue: number;
  expenses: number;
  profit: number;           // (actual + planned revenue) - expenses
  actualProfit: number;
  plannedProfit: number;
  expenseCategories: CategoryBreakdown[];
  expenseTxCount: number;
}

export interface W2Breakdown {
  kind: "w2";
  companyName: string;
  grossWages: number;       // actual + planned
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
  grossAmount: number;        // actual + planned
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
  // Sources
  sources: IncomeSourceBreakdown[];
  // Aggregates (totals already include planned when mode === "forecast")
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
  standardDeduction: number;
  itemizedDeduction: number;
  deductionApplied: number;
  deductionType: "standard" | "itemized";
  seDeductibleHalf: number;
  // Planned-only totals (zero when mode === "actual")
  plannedBusinessRevenue: number;
  plannedW2Income: number;
  plannedOtherIncome: number;
  plannedPreTax: number;
  plannedRetirement: number;
  plannedTotalIncome: number;
  // Actual-only totals (always reflect actuals regardless of mode)
  actualBusinessRevenue: number;
  actualW2Income: number;
  actualOtherIncome: number;
  // Tax calc
  taxableOrdinaryIncome: number;
  taxableLTCG: number;
  totalTaxableIncome: number;
  ordinaryBracketCalc: BracketCalc;
  ltcgBracketCalc: BracketCalc;
  seTax: SETaxCalc;
  /** Federal income tax computed from brackets, before applying dependent credits */
  federalTaxBeforeCredits: number;
  /** Child + other-dependent credits (with phase-out) */
  dependentCredits: number;
  qualifyingChildrenCount: number;
  otherDependentsCount: number;
  totalEstimatedTax: number;
  /** Personal state tax due (already net of personal state withholding) */
  personalStateTax: number;
  /** Business state tax due (already net of business state withholding) */
  businessStateTax: number;
  /** Sum of personal + business state tax */
  stateTax: number;
  effectiveRate: number; // 0-1
  marginalRate: number; // 0-1
  // Optional withholding override
  withholdingOverrideType: "none" | "percent" | "amount";
  withholdingOverridePercent: number | null;
  withholdingOverrideAmount: number | null;
  /** Annual target derived from override (or estimated tax if no override) */
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

  return useMemo(() => {
    const filingStatus: FilingStatus = (settings?.filingStatus as FilingStatus) ?? "single";

    // Filter by company if requested
    const matchCompany = (entity?: string | null) =>
      !filterCompanyName || (entity ?? "") === filterCompanyName;

    // ── Group income_entries by company (ACTUAL) ──
    interface CompanyAgg {
      name: string;
      filingType: FilingType;
      actualGross: number;
      plannedGross: number;
      preTax: number;
      retirement: number;
      withheld: number;
      stateWithheld: number;
      federalWithheld: number;
      plannedPreTax: number;
      plannedRetirement: number;
    }
    const companyAgg = new Map<string, CompanyAgg>();

    const ensureAgg = (name: string, ft: FilingType): CompanyAgg => {
      const key = `${name}::${ft}`;
      const existing = companyAgg.get(key) ?? {
        name,
        filingType: ft,
        actualGross: 0,
        plannedGross: 0,
        preTax: 0,
        retirement: 0,
        withheld: 0,
        stateWithheld: 0,
        federalWithheld: 0,
        plannedPreTax: 0,
        plannedRetirement: 0,
      };
      companyAgg.set(key, existing);
      return existing;
    };

    for (const e of incomes) {
      if (!matchCompany(e.company)) continue;
      const ft = normalizeFilingType(e.income_type);
      const agg = ensureAgg(e.company || "Unassigned", ft);
      agg.actualGross += Number(e.paycheck_amount) || 0;
      agg.preTax += Number(e.pre_tax_deductions) || 0;
      agg.retirement += Number(e.retirement_401k) || 0;
      agg.withheld += Number(e.taxes_withheld) || 0;
      agg.federalWithheld += Number((e as any).federal_withholding) || 0;
      agg.stateWithheld += Number((e as any).state_withholding) || 0;
    }

    // ── Add PLANNED income (only when mode === "forecast") ──
    let plannedPreTaxTotal = 0;
    let plannedRetirementTotal = 0;
    if (mode === "forecast") {
      const paychecks = generateProjectedPaychecks(streams, bonuses, incomes, overrides);
      // Only "active" (future, unmatched) paychecks count as planned add-on
      const activePlanned = paychecks.filter((p) => p.matchStatus === "active");
      for (const p of activePlanned) {
        const company = p.label.split(" (")[0]; // bonuses formatted "<bonusName> (<company>)"
        const stream = streams.find((s) => s.id === p.streamId);
        const ft = normalizeFilingType(stream?.company_type || "1099");
        const companyName = stream?.company || company || "Planned";
        if (!matchCompany(companyName)) continue;
        const agg = ensureAgg(companyName, ft);
        agg.plannedGross += p.grossAmount;
        agg.plannedPreTax += p.preTaxDeductions;
        agg.plannedRetirement += p.retirement401k;
        agg.preTax += p.preTaxDeductions;
        agg.retirement += p.retirement401k;
        agg.withheld += p.taxesWithheld;
        plannedPreTaxTotal += p.preTaxDeductions;
        plannedRetirementTotal += p.retirement401k;
      }
    }

    // ── Group expense transactions by company ──
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
      if (txType === "transfer" || (tx as any).excluded_from_reports) continue;

      if (txType === "expense") {
        const company = tx.entity || "Unassigned";
        const knownCompany = companies.find((c) => c.name === company);
        if (!knownCompany) continue;

        const amt = Math.abs(Number(tx.amount) || 0);
        const cat: ScheduleCCategory =
          ((tx as any).schedule_c_category as ScheduleCCategory) ||
          mapToScheduleC(tx.category);

        const agg = expensesByCompany.get(company) ?? {
          total: 0,
          byCategory: new Map(),
          txCount: 0,
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

    // ── Build source breakdowns ──
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
    let preTaxDeductions = 0;
    let retirement401k = 0;
    let totalSEIncome = 0;

    for (const agg of companyAgg.values()) {
      const kind = FILING_TO_KIND(agg.filingType);
      const totalGross = agg.actualGross + agg.plannedGross;
      preTaxDeductions += agg.preTax;
      retirement401k += agg.retirement;

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
          federalWithheld: agg.federalWithheld + agg.withheld,
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
        if (agg.filingType === "1099_schedule_c" || agg.filingType === "k1_partnership") {
          totalSEIncome += Math.max(0, profit);
        }
        const expenseCategories: CategoryBreakdown[] = exp
          ? Array.from(exp.byCategory.entries())
              .map(([category, v]) => ({ category, total: v.total, count: v.count }))
              .sort((a, b) => b.total - a.total)
          : [];
        const companyId = companies.find((c) => c.name === agg.name)?.id ?? null;
        sources.push({
          kind: "business",
          companyId,
          companyName: agg.name,
          filingType: agg.filingType,
          revenue: totalGross,
          actualRevenue: agg.actualGross,
          plannedRevenue: agg.plannedGross,
          expenses,
          profit,
          actualProfit,
          plannedProfit,
          expenseCategories,
          expenseTxCount: exp?.txCount ?? 0,
        });
      } else {
        totalOtherIncome += totalGross;
        actualOtherIncome += agg.actualGross;
        plannedOtherIncome += agg.plannedGross;
        sources.push({
          kind: "other",
          companyName: agg.name,
          filingType: agg.filingType,
          grossAmount: totalGross,
          actualGrossAmount: agg.actualGross,
          plannedGrossAmount: agg.plannedGross,
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

    // ── Tax math ──
    const seTax = calcSETax(totalSEIncome, totalW2Income);
    const ordinaryGross =
      totalW2Income + totalBusinessProfit + totalShortTermGains + totalOtherIncome;

    const standardDeduction = settings?.standardDeductionOverride ?? STANDARD_DEDUCTION_2025[filingStatus];
    const itemizedDeduction = Number(settings?.itemizedDeductionAmount) || 0;
    const deductionType: "standard" | "itemized" = settings?.deductionType === "itemized" ? "itemized" : "standard";
    const deductionApplied = deductionType === "itemized"
      ? Math.max(0, itemizedDeduction)
      : standardDeduction;

    const totalDeductions = preTaxDeductions + retirement401k + seTax.deductibleHalf + deductionApplied;
    const totalGrossIncome = ordinaryGross + totalLongTermGains;

    const taxableOrdinaryIncome = Math.max(
      0,
      ordinaryGross - preTaxDeductions - retirement401k - seTax.deductibleHalf - deductionApplied,
    );
    const taxableLTCG = Math.max(0, totalLongTermGains);
    const totalTaxableIncome = taxableOrdinaryIncome + taxableLTCG;

    const ordBrackets = ORDINARY_BRACKETS_2025[filingStatus];
    const ltcgBrackets = LTCG_BRACKETS_2025[filingStatus];

    const ordinaryBracketCalc = calcBracketTax(taxableOrdinaryIncome, ordBrackets);
    const ltcgRawCalc = calcBracketTax(taxableOrdinaryIncome + taxableLTCG, ltcgBrackets);
    const ltcgBaselineCalc = calcBracketTax(taxableOrdinaryIncome, ltcgBrackets);
    const ltcgBracketCalc: BracketCalc = {
      total: Math.max(0, ltcgRawCalc.total - ltcgBaselineCalc.total),
      lines: ltcgRawCalc.lines,
    };

    const federalTaxBeforeCredits = ordinaryBracketCalc.total + ltcgBracketCalc.total;
    const qualifyingChildrenCount = Number(settings?.qualifyingChildrenCount) || 0;
    const otherDependentsCount = Number(settings?.otherDependentsCount) || 0;
    // Use AGI-ish proxy = gross - pretax/retirement/½SE
    const agiProxy = Math.max(0, totalGrossIncome - preTaxDeductions - retirement401k - seTax.deductibleHalf);
    const dependentCredits = calculateDependentCredits(
      qualifyingChildrenCount,
      otherDependentsCount,
      agiProxy,
      filingStatus,
    );

    const federalAfterCredits = Math.max(0, federalTaxBeforeCredits - dependentCredits);

    // ── State tax (separate engine) ──
    // Determine eligible business gross/expenses based on application mode + per-company toggle
    const businessAppMode = (settings as any)?.businessStateTaxApplicationMode ?? "all_business";
    const businessSelectedIds: string[] = Array.isArray((settings as any)?.businessStateTaxCompanyIds)
      ? (settings as any).businessStateTaxCompanyIds
      : [];
    let eligibleBusinessGross = 0;
    let eligibleBusinessExpenses = 0;
    for (const s of sources) {
      if (s.kind !== "business") continue;
      const co = companies.find((c) => c.name === s.companyName);
      const perCompanyOn = co ? (co as any).applyBusinessStateTax !== false : true;
      const inSelection =
        businessAppMode === "selected"
          ? co ? businessSelectedIds.includes(co.id) : false
          : true;
      if (!perCompanyOn || !inSelection) continue;
      eligibleBusinessGross += s.revenue;
      eligibleBusinessExpenses += s.expenses;
    }

    const stateInputs = {
      stateTaxEnabled: !!settings?.stateTaxEnabled,
      personalStateTaxMode: settings?.personalStateTaxMode,
      personalStateTaxRate: settings?.personalStateTaxRate,
      personalStateTaxAnnualEstimate: settings?.personalStateTaxAnnualEstimate,
      businessStateTaxEnabled: !!(settings as any)?.businessStateTaxEnabled,
      businessStateTaxRate: (settings as any)?.businessStateTaxRate,
      businessStateTaxBase: (settings as any)?.businessStateTaxBase,
      eligibleBusinessGross,
      eligibleBusinessExpenses,
    } as any;

    const personalState = calculatePersonalStateTax({
      taxableIncome: taxableOrdinaryIncome,
      agi: agiProxy,
      inputs: stateInputs,
    });
    const businessState = calculateBusinessStateTax({ inputs: stateInputs });
    const personalStateTax = personalState.tax;
    const businessStateTax = businessState.tax;
    const stateTax = personalStateTax + businessStateTax;

    const totalEstimatedTax = federalAfterCredits + seTax.total + stateTax;

    const effectiveRate = totalGrossIncome > 0 ? totalEstimatedTax / totalGrossIncome : 0;
    const marginalRate = getMarginalRate(taxableOrdinaryIncome, ordBrackets);

    // Optional withholding override → annual target (planning layer only)
    const withholdingOverrideType = (settings?.withholdingOverrideType as "none" | "percent" | "amount") ?? "none";
    const withholdingOverridePercent = settings?.withholdingOverridePercent ?? null;
    const withholdingOverrideAmount = settings?.withholdingOverrideAmount ?? null;
    let targetAnnualWithholding = totalEstimatedTax;
    if (withholdingOverrideType === "percent" && withholdingOverridePercent != null) {
      targetAnnualWithholding = totalGrossIncome * (withholdingOverridePercent / 100);
    } else if (withholdingOverrideType === "amount" && withholdingOverrideAmount != null) {
      // Treat as monthly target → annualize for planning summary
      targetAnnualWithholding = withholdingOverrideAmount * 12;
    }

    return {
      mode,
      filingStatus,
      sources,
      totalBusinessRevenue,
      totalBusinessExpenses,
      totalBusinessProfit,
      totalW2Income,
      totalShortTermGains,
      totalLongTermGains,
      totalOtherIncome,
      totalGrossIncome,
      totalDeductions,
      preTaxDeductions,
      retirement401k,
      standardDeduction,
      itemizedDeduction,
      deductionApplied,
      deductionType,
      seDeductibleHalf: seTax.deductibleHalf,
      plannedBusinessRevenue,
      plannedW2Income,
      plannedOtherIncome,
      plannedPreTax: plannedPreTaxTotal,
      plannedRetirement: plannedRetirementTotal,
      plannedTotalIncome: plannedBusinessRevenue + plannedW2Income + plannedOtherIncome,
      actualBusinessRevenue,
      actualW2Income,
      actualOtherIncome,
      taxableOrdinaryIncome,
      taxableLTCG,
      totalTaxableIncome,
      ordinaryBracketCalc,
      ltcgBracketCalc,
      seTax,
      federalTaxBeforeCredits,
      dependentCredits,
      qualifyingChildrenCount,
      otherDependentsCount,
      totalEstimatedTax,
      personalStateTax,
      businessStateTax,
      stateTax,
      effectiveRate,
      marginalRate,
      withholdingOverrideType,
      withholdingOverridePercent,
      withholdingOverrideAmount,
      targetAnnualWithholding,
      isLoading: sLoading || tLoading || iLoading || stLoading || bLoading || oLoading,
    };
  }, [settings, txs, incomes, companies, streams, bonuses, overrides, filterCompanyName, mode, sLoading, tLoading, iLoading, stLoading, bLoading, oLoading]);
}
