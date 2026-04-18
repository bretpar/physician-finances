import { useMemo } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useCompanies } from "@/contexts/CompanyContext";
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
  expenses: number;
  profit: number;
  expenseCategories: CategoryBreakdown[];
  expenseTxCount: number;
}

export interface W2Breakdown {
  kind: "w2";
  companyName: string;
  grossWages: number;
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
  taxableAmount: number;
}

export type IncomeSourceBreakdown =
  | BusinessBreakdown
  | W2Breakdown
  | CapGainsBreakdown
  | OtherIncomeBreakdown;

export interface TaxBreakdownResult {
  filingStatus: FilingStatus;
  // Sources
  sources: IncomeSourceBreakdown[];
  // Aggregates
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
  seDeductibleHalf: number;
  // Tax calc
  taxableOrdinaryIncome: number;
  taxableLTCG: number;
  totalTaxableIncome: number;
  ordinaryBracketCalc: BracketCalc;
  ltcgBracketCalc: BracketCalc;
  seTax: SETaxCalc;
  totalEstimatedTax: number;
  effectiveRate: number; // 0-1
  marginalRate: number; // 0-1
  isLoading: boolean;
}

const FILING_TO_KIND = (ft: FilingType): IncomeSourceBreakdown["kind"] => {
  if (ft === "w2" || ft === "scorp_w2") return "w2";
  if (ft === "1099_schedule_c" || ft === "k1_partnership" || ft === "scorp_distribution")
    return "business";
  return "other";
};

export function useTaxBreakdown(filterCompanyName?: string): TaxBreakdownResult {
  const { data: settings, isLoading: sLoading } = useTaxSettings();
  const { data: txs = [], isLoading: tLoading } = useTransactions();
  const { data: incomes = [], isLoading: iLoading } = useIncomeEntries();
  const { companies } = useCompanies();

  return useMemo(() => {
    const filingStatus: FilingStatus = (settings?.filingStatus as FilingStatus) ?? "single";

    // Filter by company if requested
    const matchCompany = (entity?: string | null) =>
      !filterCompanyName || (entity ?? "") === filterCompanyName;

    // ── Group income_entries by company ──
    interface CompanyAgg {
      name: string;
      filingType: FilingType;
      gross: number;
      preTax: number;
      retirement: number;
      withheld: number;
      stateWithheld: number;
      federalWithheld: number;
    }
    const companyAgg = new Map<string, CompanyAgg>();

    for (const e of incomes) {
      if (!matchCompany(e.company)) continue;
      const ft = normalizeFilingType(e.income_type);
      const key = `${e.company || "Unassigned"}::${ft}`;
      const existing = companyAgg.get(key) ?? {
        name: e.company || "Unassigned",
        filingType: ft,
        gross: 0,
        preTax: 0,
        retirement: 0,
        withheld: 0,
        stateWithheld: 0,
        federalWithheld: 0,
      };
      existing.gross += Number(e.paycheck_amount) || 0;
      existing.preTax += Number(e.pre_tax_deductions) || 0;
      existing.retirement += Number(e.retirement_401k) || 0;
      existing.withheld += Number(e.taxes_withheld) || 0;
      existing.federalWithheld += Number((e as any).federal_withholding) || 0;
      existing.stateWithheld += Number((e as any).state_withholding) || 0;
      companyAgg.set(key, existing);
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
        // Only count expenses that belong to a known business company
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
        // Heuristic: positive = gain, negative = loss; we don't have term yet
        // so categorize all as short-term unless flagged in notes
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
    let preTaxDeductions = 0;
    let retirement401k = 0;
    let totalWithheld = 0;
    let totalSEIncome = 0;

    for (const agg of companyAgg.values()) {
      const kind = FILING_TO_KIND(agg.filingType);
      preTaxDeductions += agg.preTax;
      retirement401k += agg.retirement;
      totalWithheld += agg.withheld + agg.federalWithheld + agg.stateWithheld;

      if (kind === "w2") {
        const taxableWages = Math.max(0, agg.gross - agg.preTax - agg.retirement);
        totalW2Income += agg.gross;
        sources.push({
          kind: "w2",
          companyName: agg.name,
          grossWages: agg.gross,
          federalWithheld: agg.federalWithheld + agg.withheld, // legacy lump
          stateWithheld: agg.stateWithheld,
          preTaxDeductions: agg.preTax,
          retirement401k: agg.retirement,
          taxableWages,
        });
      } else if (kind === "business") {
        const exp = expensesByCompany.get(agg.name);
        const expenses = exp?.total ?? 0;
        const profit = agg.gross - expenses;
        totalBusinessRevenue += agg.gross;
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
          revenue: agg.gross,
          expenses,
          profit,
          expenseCategories,
          expenseTxCount: exp?.txCount ?? 0,
        });
      } else {
        totalOtherIncome += agg.gross;
        sources.push({
          kind: "other",
          companyName: agg.name,
          filingType: agg.filingType,
          grossAmount: agg.gross,
          taxableAmount: Math.max(0, agg.gross - agg.preTax - agg.retirement),
        });
      }
    }

    // Add capital gains as a synthetic source if any
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

    // Ordinary income = W2 + business profit + ST cap gains + other
    const ordinaryGross =
      totalW2Income + totalBusinessProfit + totalShortTermGains + totalOtherIncome;
    const standardDeduction = STANDARD_DEDUCTION_2025[filingStatus];
    const totalDeductions = preTaxDeductions + retirement401k + seTax.deductibleHalf + standardDeduction;
    const totalGrossIncome = ordinaryGross + totalLongTermGains;

    const taxableOrdinaryIncome = Math.max(
      0,
      ordinaryGross - preTaxDeductions - retirement401k - seTax.deductibleHalf - standardDeduction,
    );
    const taxableLTCG = Math.max(0, totalLongTermGains);
    const totalTaxableIncome = taxableOrdinaryIncome + taxableLTCG;

    const ordBrackets = ORDINARY_BRACKETS_2025[filingStatus];
    const ltcgBrackets = LTCG_BRACKETS_2025[filingStatus];

    const ordinaryBracketCalc = calcBracketTax(taxableOrdinaryIncome, ordBrackets);
    // LTCG stacked on top of ordinary
    const ltcgRawCalc = calcBracketTax(taxableOrdinaryIncome + taxableLTCG, ltcgBrackets);
    const ltcgBaselineCalc = calcBracketTax(taxableOrdinaryIncome, ltcgBrackets);
    const ltcgBracketCalc: BracketCalc = {
      total: Math.max(0, ltcgRawCalc.total - ltcgBaselineCalc.total),
      lines: ltcgRawCalc.lines, // show the stacked picture; UI explains
    };

    const totalEstimatedTax =
      ordinaryBracketCalc.total + ltcgBracketCalc.total + seTax.total;

    const effectiveRate = totalGrossIncome > 0 ? totalEstimatedTax / totalGrossIncome : 0;
    const marginalRate = getMarginalRate(taxableOrdinaryIncome, ordBrackets);

    return {
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
      seDeductibleHalf: seTax.deductibleHalf,
      taxableOrdinaryIncome,
      taxableLTCG,
      totalTaxableIncome,
      ordinaryBracketCalc,
      ltcgBracketCalc,
      seTax,
      totalEstimatedTax,
      effectiveRate,
      marginalRate,
      isLoading: sLoading || tLoading || iLoading,
    };
  }, [settings, txs, incomes, companies, filterCompanyName, sLoading, tLoading, iLoading]);
}
