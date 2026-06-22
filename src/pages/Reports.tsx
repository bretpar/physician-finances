import { useState, useMemo } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useInvestmentIncomeEntries, aggregateInvestmentTaxBuckets } from "@/hooks/useInvestmentIncome";
import { useRetirementContributions, useAnnualizedContributions } from "@/hooks/useRetirementContributions";
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { useCompanies } from "@/contexts/CompanyContext";
import { useMileageYTD, getIrsMileageRate } from "@/hooks/useMileage";
import { useHsaContributions } from "@/hooks/useHsaContributions";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useQuarterRecommendationInput } from "@/hooks/useQuarterRecommendationInput";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";
import { mapLegacyCategory, EXPENSE_CATEGORIES } from "@/components/ExpenseCategoryCombobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/DateField";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Download, FileText, Building2, ChevronDown } from "lucide-react";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { HOME_OFFICE_REPORT_LABEL } from "@/lib/homeOfficeDeduction";
import { classifyPersonalIncome } from "@/lib/incomeClassification";
import { exportTaxPrepPdf, type TransactionRow } from "@/lib/taxPrepPdf";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type QuickRange = "this_month" | "last_month" | "qtd" | "ytd" | "custom";

function getDateRange(quick: QuickRange): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (quick) {
    case "this_month":
      return { from: `${y}-${pad(m + 1)}-01`, to: now.toISOString().split("T")[0] };
    case "last_month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      const lastDay = new Date(ly, lm + 1, 0).getDate();
      return { from: `${ly}-${pad(lm + 1)}-01`, to: `${ly}-${pad(lm + 1)}-${pad(lastDay)}` };
    }
    case "qtd": {
      const qStart = Math.floor(m / 3) * 3;
      return { from: `${y}-${pad(qStart + 1)}-01`, to: now.toISOString().split("T")[0] };
    }
    case "ytd":
      return { from: `${y}-01-01`, to: now.toISOString().split("T")[0] };
    default:
      return { from: `${y}-01-01`, to: now.toISOString().split("T")[0] };
  }
}

export default function Reports() {
  const { data: transactions = [] } = useTransactions();
  const { data: incomeEntries = [] } = useIncomeEntries();
  const { data: personalEntries = [] } = usePersonalIncomeEntries();
  const { data: investmentEntries = [] } = useInvestmentIncomeEntries();
  const { data: retirementContribs = [] } = useRetirementContributions();
  const annualizedRetirement = useAnnualizedContributions(retirementContribs);
  const { data: taxPayments = [] } = useTaxPayments();
  const { data: taxSavings = [] } = useTaxSavings();
  const { companies } = useCompanies();
  const currentYearForMileage = new Date().getFullYear();
  const { data: ytdMileage = [] } = useMileageYTD(currentYearForMileage);
  const { data: hsaRows = [] } = useHsaContributions(currentYearForMileage);
  const { actualEstimate, forecastEstimate } = useTaxEstimate();
  const { data: taxSettings } = useTaxSettings();
  const quarterInputBase = useQuarterRecommendationInput();

  const VEHICLE_CATEGORY = "Car and truck expenses";
  const HOME_OFFICE_CATEGORY = HOME_OFFICE_REPORT_LABEL;

  // Resolve mileage entries to a company NAME (Reports filters by entity name).
  const mileageByCompanyName = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of ytdMileage) {
      if (!e.company_id) continue;
      const c = companies.find((x) => x.id === e.company_id);
      if (!c) continue;
      const dollars = Number(e.miles) * getIrsMileageRate(e.year);
      m.set(c.name, (m.get(c.name) || 0) + dollars);
    }
    return m;
  }, [ytdMileage, companies]);

  // P&L state
  const [plCompany, setPlCompany] = useState("all");
  const [quickRange, setQuickRange] = useState<QuickRange>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Tax Summary state
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(String(currentYear));
  const [taxCompany, setTaxCompany] = useState("all");
  const [includeAppendix, setIncludeAppendix] = useState(false);
  const [scheduleCOpen, setScheduleCOpen] = useState(false);
  const { data: homeOfficeDeductions = [] } = useHomeOfficeDeductions(Number(taxYear));

  const dateRange = useMemo(() => {
    if (quickRange === "custom") return { from: customFrom, to: customTo };
    return getDateRange(quickRange);
  }, [quickRange, customFrom, customTo]);

  // ──── P&L Computation ────
  const plData = useMemo(() => {
    const expenseTxs = transactions.filter((t) => {
      if (t.transaction_type !== "expense") return false;
      if (isExcludedFromBusiness(t as any)) return false;
      if (plCompany !== "all" && t.entity !== plCompany) return false;
      if (dateRange.from && t.transaction_date < dateRange.from) return false;
      if (dateRange.to && t.transaction_date > dateRange.to) return false;
      return true;
    });

    const incomeTxs = transactions.filter((t) => {
      if (t.transaction_type !== "income") return false;
      if (isExcludedFromBusiness(t as any)) return false;
      if (plCompany !== "all" && t.entity !== plCompany) return false;
      if (dateRange.from && t.transaction_date < dateRange.from) return false;
      if (dateRange.to && t.transaction_date > dateRange.to) return false;
      return true;
    });

    const grossIncome = incomeTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const txExpenseTotal = expenseTxs.reduce((s, t) => s + Math.abs(t.amount), 0);

    let mileageDed = 0;
    if (plCompany === "all") {
      for (const v of mileageByCompanyName.values()) mileageDed += v;
    } else {
      mileageDed = mileageByCompanyName.get(plCompany) || 0;
    }
    const byCategory: Record<string, number> = {};
    for (const t of expenseTxs) {
      const cat = mapLegacyCategory(t.category);
      byCategory[cat] = (byCategory[cat] || 0) + Math.abs(t.amount);
    }
    if (mileageDed > 0) {
      byCategory[VEHICLE_CATEGORY] = (byCategory[VEHICLE_CATEGORY] || 0) + mileageDed;
    }
    const homeOfficeDed = homeOfficeDeductions
      .filter((d) => d.include_in_tax_calculation && d.status === "active")
      .filter((d) => plCompany === "all" || companies.find((c) => c.id === d.company_id)?.name === plCompany)
      .reduce((s, d) => s + Number(d.allowed_amount || 0), 0);
    if (homeOfficeDed > 0) byCategory[HOME_OFFICE_CATEGORY] = homeOfficeDed;

    const totalExpenses = txExpenseTotal + mileageDed + homeOfficeDed;
    return {
      grossIncome,
      totalExpenses,
      mileageDeduction: mileageDed,
      homeOfficeDeduction: homeOfficeDed,
      netProfit: grossIncome - totalExpenses,
      byCategory,
    };
  }, [transactions, plCompany, dateRange, mileageByCompanyName, homeOfficeDeductions, companies, HOME_OFFICE_CATEGORY]);

  // ──── Annual Tax Summary — Business / Schedule C ────
  const taxData = useMemo(() => {
    const yearStart = `${taxYear}-01-01`;
    const yearEnd = `${taxYear}-12-31`;

    const expenseTxs = transactions.filter((t) => {
      if (t.transaction_type !== "expense") return false;
      if (isExcludedFromBusiness(t as any)) return false;
      if (taxCompany !== "all" && t.entity !== taxCompany) return false;
      return t.transaction_date >= yearStart && t.transaction_date <= yearEnd;
    });

    const incomeTxs = transactions.filter((t) => {
      if (t.transaction_type !== "income") return false;
      if (isExcludedFromBusiness(t as any)) return false;
      if (taxCompany !== "all" && t.entity !== taxCompany) return false;
      return t.transaction_date >= yearStart && t.transaction_date <= yearEnd;
    });

    const grossIncome = incomeTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const txExpenseTotal = expenseTxs.reduce((s, t) => s + Math.abs(t.amount), 0);

    let mileageDed = 0;
    if (taxCompany === "all") {
      for (const v of mileageByCompanyName.values()) mileageDed += v;
    } else {
      mileageDed = mileageByCompanyName.get(taxCompany) || 0;
    }
    const homeOfficeDed = homeOfficeDeductions
      .filter((d) => d.include_in_tax_calculation && d.status === "active")
      .filter((d) => taxCompany === "all" || companies.find((c) => c.id === d.company_id)?.name === taxCompany)
      .reduce((s, d) => s + Number(d.allowed_amount || 0), 0);
    const totalExpenses = txExpenseTotal + mileageDed + homeOfficeDed;

    const byCategory: Record<string, number> = {};
    for (const cat of EXPENSE_CATEGORIES) byCategory[cat] = 0;
    for (const t of expenseTxs) {
      const cat = mapLegacyCategory(t.category);
      byCategory[cat] = (byCategory[cat] || 0) + Math.abs(t.amount);
    }
    byCategory[VEHICLE_CATEGORY] = (byCategory[VEHICLE_CATEGORY] || 0) + mileageDed;
    byCategory[HOME_OFFICE_CATEGORY] = homeOfficeDed;

    return {
      grossIncome,
      totalExpenses,
      mileageDeduction: mileageDed,
      homeOfficeDeduction: homeOfficeDed,
      netProfit: grossIncome - totalExpenses,
      byCategory,
      incomeTxs,
      expenseTxs,
    };
  }, [transactions, taxCompany, taxYear, mileageByCompanyName, homeOfficeDeductions, companies, HOME_OFFICE_CATEGORY]);

  // ──── Income Summary (Section 1) ────
  const incomeSummary = useMemo(() => {
    const yearStart = `${taxYear}-01-01`;
    const yearEnd = `${taxYear}-12-31`;
    const companyByName = new Map(companies.map((c) => [c.name, c]));

    // Business income txs split by company filing type
    let bizW2 = 0;
    let biz1099 = 0;
    let bizK1 = 0;
    let bizOther = 0;
    for (const t of transactions) {
      if (t.transaction_type !== "income") continue;
      if (isExcludedFromBusiness(t as any)) continue;
      if (t.transaction_date < yearStart || t.transaction_date > yearEnd) continue;
      if (taxCompany !== "all" && t.entity !== taxCompany) continue;
      const amt = Math.abs(Number(t.amount) || 0);
      const c = companyByName.get(t.entity || "");
      const ct = c?.companyType;
      if (ct === "w2" || ct === "scorp_w2") bizW2 += amt;
      else if (ct === "1099_schedule_c") biz1099 += amt;
      else if (ct === "k1_partnership") bizK1 += amt;
      else bizOther += amt;
    }

    // Personal income entries
    let perW2 = 0;
    let perOrdinary = 0;
    let interest = 0;
    let dividend = 0;
    let perCapGains = 0;
    for (const e of personalEntries) {
      if (e.income_date < yearStart || e.income_date > yearEnd) continue;
      if (taxCompany !== "all" && (e as any).company !== taxCompany) continue;
      const amt = Number(e.gross_amount || 0);
      const subtype = (e as any).ui_income_subtype?.toLowerCase() || "";
      const cat = classifyPersonalIncome(e as any);
      if (subtype === "interest") interest += amt;
      else if (subtype === "dividend" || subtype === "dividends") dividend += amt;
      else if (cat === "w2") perW2 += amt;
      else if (cat === "capital_gains") perCapGains += amt;
      else if (cat === "loss") {
        /* skip — losses tracked in tax engine */
      } else perOrdinary += amt;
    }

    // Investment income (year-filtered)
    const investYearEntries = investmentEntries.filter(
      (e) => e.entry_date >= yearStart && e.entry_date <= yearEnd,
    );
    const investBuckets = aggregateInvestmentTaxBuckets(investYearEntries);
    const investmentTotal = investBuckets.shortTermSales + investBuckets.longTermSales;
    const investmentDividends = investBuckets.dividends;

    const w2 = bizW2 + perW2;
    const income1099 = biz1099 + perOrdinary + bizOther;
    const k1 = bizK1;
    const investment = perCapGains + investmentTotal;
    const dividendTotal = dividend + investmentDividends;
    const total = w2 + income1099 + k1 + investment + interest + dividendTotal;

    return { w2, income1099, k1, investment, interest, dividend: dividendTotal, total };
  }, [transactions, personalEntries, investmentEntries, taxYear, taxCompany, companies]);

  // ──── Deductions Summary (Section 3) ────
  const deductions = useMemo(() => {
    const yearMatch = (d: string) => d?.startsWith(taxYear);
    const hsaForYear = hsaRows
      .filter((r) => yearMatch(r.contribution_date))
      .reduce((s, r) => s + Number(r.amount), 0);
    const healthcareForYear = incomeEntries
      .filter((e) => yearMatch(e.income_date))
      .reduce((s, e) => s + Number((e as any).healthcare_deduction || 0), 0);
    const homeOfficeTotal = homeOfficeDeductions
      .filter((d) => d.include_in_tax_calculation && d.status === "active")
      .reduce((s, d) => s + Number(d.allowed_amount || 0), 0);
    // For current year use annualized projection; for past years use 0 (not stored historically)
    const retirement401k = Number(taxYear) === currentYear ? annualizedRetirement.total : 0;
    return {
      hsa: hsaForYear,
      healthcare: healthcareForYear,
      mileage: taxData.mileageDeduction,
      homeOffice: homeOfficeTotal,
      retirement401k,
    };
  }, [hsaRows, incomeEntries, homeOfficeDeductions, taxData.mileageDeduction, annualizedRetirement.total, taxYear, currentYear]);

  // ──── Tax Summary (Section 4) ────
  const taxSummary = useMemo(() => {
    const isCurrentYear = Number(taxYear) === currentYear;
    const est = isCurrentYear ? (forecastEstimate ?? actualEstimate) : null;
    const yearMatch = (d: string) => d?.startsWith(taxYear);
    const paymentsMade = taxPayments
      .filter((p) => Number(p.applied_tax_year) === Number(taxYear))
      .reduce((s, p) => s + Number(p.amount), 0);
    const reserveSaved = taxSavings
      .filter((s) => yearMatch(s.savings_date))
      .reduce((sum, s) => sum + Number(s.amount), 0);

    if (!est) {
      return {
        totalLiability: 0,
        federal: 0,
        state: 0,
        selfEmployment: 0,
        withheld: 0,
        reserveSaved,
        paymentsMade,
        remaining: 0,
        available: false,
      };
    }
    const state = (est.personalStateTax || 0) + (est.businessStateTax || 0);
    const withheld = est.taxesAlreadyWithheld || 0;
    const totalLiability = est.totalTaxLiability || 0;
    const remaining = Math.max(0, totalLiability - withheld - paymentsMade - reserveSaved);
    return {
      totalLiability,
      federal: est.federalTax || 0,
      state,
      selfEmployment: est.seTax?.total || 0,
      withheld,
      reserveSaved,
      paymentsMade,
      remaining,
      available: true,
    };
  }, [actualEstimate, forecastEstimate, taxYear, currentYear, taxPayments, taxSavings]);

  // ──── Quarterly (Section 5) ────
  const quarterly = useMemo(() => {
    const isCurrentYear = Number(taxYear) === currentYear;
    if (!isCurrentYear) {
      // For prior years, just show payments paid per quarter
      const byQ: Record<string, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
      for (const p of taxPayments) {
        if (Number(p.applied_tax_year) !== Number(taxYear)) continue;
        const q = p.applied_quarter || p.quarter;
        if (q && byQ[q] !== undefined) byQ[q] += Number(p.amount);
      }
      return [1, 2, 3, 4].map((q) => ({
        quarter: `Q${q}` as const,
        recommended: 0,
        paid: byQ[`Q${q}`],
        remaining: 0,
      }));
    }
    return [1, 2, 3, 4].map((q) => {
      const rec = buildQuarterRecommendation({
        year: Number(taxYear),
        quarter: q as 1 | 2 | 3 | 4,
        annualTaxLiability: quarterInputBase.annualTaxLiability,
        quarterMethod: quarterInputBase.quarterMethod,
        incomeEntries: quarterInputBase.incomeEntries,
        personalEntries: quarterInputBase.personalEntries,
        transactions: quarterInputBase.transactions,
        investmentEntries: quarterInputBase.investmentEntries,
        projectedPaychecks: quarterInputBase.projectedPaychecks,
        payments: quarterInputBase.payments,
        manualSavings: quarterInputBase.manualSavings,
      });
      return {
        quarter: `Q${q}` as const,
        recommended: rec.recommendedPaymentToMake,
        paid: rec.paidThisQuarter,
        remaining: rec.recommendedPaymentToMake,
      };
    });
  }, [taxYear, currentYear, quarterInputBase, taxPayments]);

  // ──── CSV Export (existing logic, reorganized) ────
  function exportPLCSV() {
    const companyLabel = plCompany === "all" ? "All Companies" : plCompany;
    let csv = `Profit & Loss Report\nCompany,${companyLabel}\nDate Range,${dateRange.from} to ${dateRange.to}\n\n`;
    csv += `Gross Income,${plData.grossIncome}\nTotal Expenses,${plData.totalExpenses}\nNet Profit/Loss,${plData.netProfit}\n\n`;
    csv += `Category,Amount\n`;
    for (const [cat, amt] of Object.entries(plData.byCategory).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (amt > 0) csv += `"${cat}",${amt}\n`;
    }
    downloadBlob(csv, "profit-loss-report.csv");
  }

  function exportTaxCSV() {
    const companyLabel = taxCompany === "all" ? "All Companies" : taxCompany;
    let csv = `Annual Tax Summary\nCompany,${companyLabel}\nTax Year,${taxYear}\n\n`;
    csv += `INCOME SUMMARY\nW-2 Income,${incomeSummary.w2}\n1099 Income,${incomeSummary.income1099}\nK-1 Income,${incomeSummary.k1}\nInvestment (cap gains),${incomeSummary.investment}\nInterest Income,${incomeSummary.interest}\nDividend Income,${incomeSummary.dividend}\nTotal Gross Income,${incomeSummary.total}\n\n`;
    csv += `BUSINESS / SCHEDULE C\nGross Receipts/Sales,${taxData.grossIncome}\n`;
    for (const cat of EXPENSE_CATEGORIES) {
      csv += `"${cat}",${taxData.byCategory[cat] || 0}\n`;
    }
    if (taxData.homeOfficeDeduction > 0) csv += `"${HOME_OFFICE_REPORT_LABEL}",${taxData.homeOfficeDeduction}\n`;
    csv += `Total Expenses,${taxData.totalExpenses}\nNet Profit/Loss,${taxData.netProfit}\n\n`;
    csv += `DEDUCTIONS\nHSA Contributions,${deductions.hsa}\n401(k) / Retirement,${deductions.retirement401k}\nMileage,${deductions.mileage}\nHome Office,${deductions.homeOffice}\nHealthcare,${deductions.healthcare}\n\n`;
    csv += `TAX SUMMARY\nFederal Tax Estimate,${taxSummary.federal}\nState Tax Estimate,${taxSummary.state}\nSelf-Employment Tax,${taxSummary.selfEmployment}\nEstimated Annual Tax Liability,${taxSummary.totalLiability}\nTaxes Already Withheld,${taxSummary.withheld}\nTax Reserve Saved,${taxSummary.reserveSaved}\nQuarterly Payments Made,${taxSummary.paymentsMade}\nRemaining Estimated Liability,${taxSummary.remaining}\n\n`;
    csv += `QUARTERLY\nQuarter,Recommended,Paid,Remaining\n`;
    for (const q of quarterly) {
      csv += `${q.quarter},${q.recommended},${q.paid ?? ""},${q.remaining ?? ""}\n`;
    }
    downloadBlob(csv, `tax-summary-${taxYear}.csv`);
  }

  function exportTaxPDF() {
    const companyLabel = taxCompany === "all" ? "All Companies" : taxCompany;
    const categories = EXPENSE_CATEGORIES.map((cat) => ({
      label: cat,
      amount: taxData.byCategory[cat] || 0,
    }));
    if (taxData.homeOfficeDeduction > 0) {
      categories.push({ label: HOME_OFFICE_REPORT_LABEL, amount: taxData.homeOfficeDeduction });
    }
    let appendixTxs: TransactionRow[] | undefined;
    if (includeAppendix) {
      const yearStart = `${taxYear}-01-01`;
      const yearEnd = `${taxYear}-12-31`;
      appendixTxs = transactions
        .filter((t) => {
          if (t.transaction_date < yearStart || t.transaction_date > yearEnd) return false;
          if (taxCompany !== "all" && t.entity !== taxCompany) return false;
          return true;
        })
        .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
        .map((t) => ({
          date: t.transaction_date,
          vendor: t.vendor || "—",
          category: mapLegacyCategory(t.category) || t.category || "—",
          amount: Math.abs(Number(t.amount) || 0),
          type: t.transaction_type as "income" | "expense",
        }));
    }
    exportTaxPrepPdf({
      taxYear,
      companyLabel,
      income: incomeSummary,
      business: {
        grossReceipts: taxData.grossIncome,
        categories,
        totalExpenses: taxData.totalExpenses,
        netProfit: taxData.netProfit,
      },
      deductions,
      tax: taxSummary,
      quarters: quarterly,
      includeAppendix,
      transactions: appendixTxs,
    });
  }

  function downloadBlob(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const companyNames = useMemo(() => {
    const names = new Set(transactions.map((t) => t.entity).filter(Boolean));
    companies.forEach((c) => names.add(c.name));
    return [...names].filter((n) => n !== "Unassigned").sort();
  }, [transactions, companies]);

  const years = useMemo(() => {
    const yrs = new Set(transactions.map((t) => t.transaction_date.slice(0, 4)));
    yrs.add(String(currentYear));
    return [...yrs].sort().reverse();
  }, [transactions, currentYear]);

  // ── Small UI helpers ──
  const SummaryCard = ({
    label,
    value,
    accent,
  }: {
    label: string;
    value: string;
    accent?: "primary" | "success" | "destructive" | "muted";
  }) => {
    const color =
      accent === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : accent === "destructive"
          ? "text-destructive"
          : accent === "primary"
            ? "text-primary"
            : "text-foreground";
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      </div>
    );
  };

  const SectionCard = ({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }) => (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );

  const KVRow = ({
    label,
    value,
    bold,
    accent,
  }: {
    label: string;
    value: string;
    bold?: boolean;
    accent?: "success" | "destructive" | "muted";
  }) => {
    const color =
      accent === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : accent === "destructive"
          ? "text-destructive"
          : accent === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
    return (
      <div className="flex justify-between py-2 border-b border-border last:border-0">
        <span className={`text-sm ${bold ? "font-semibold" : ""} text-foreground`}>{label}</span>
        <span className={`text-sm tabular-nums ${bold ? "font-bold" : ""} ${color}`}>{value}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-foreground">Reports</h1>

      <Tabs defaultValue="pnl" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pnl" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Profit & Loss
          </TabsTrigger>
          <TabsTrigger value="tax" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Annual Tax Summary
          </TabsTrigger>
        </TabsList>

        {/* ══════════ PROFIT & LOSS ══════════ */}
        <TabsContent value="pnl" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Company</label>
              <Select value={plCompany} onValueChange={setPlCompany}>
                <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companyNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Period</label>
              <div className="flex gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
                {([
                  ["this_month", "This Month"],
                  ["last_month", "Last Month"],
                  ["qtd", "QTD"],
                  ["ytd", "YTD"],
                  ["custom", "Custom"],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setQuickRange(val)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      quickRange === val ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {quickRange === "custom" && (
              <div className="flex gap-2 items-center">
                <DateField value={customFrom} onChange={setCustomFrom} className="w-[150px]" />
                <span className="text-xs text-muted-foreground">to</span>
                <DateField value={customTo} onChange={setCustomTo} className="w-[150px]" />
              </div>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={exportPLCSV}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Gross Income" value={fmt(plData.grossIncome)} />
            <SummaryCard label="Total Expenses" value={fmt(plData.totalExpenses)} />
            <SummaryCard
              label="Net Profit / Loss"
              value={fmt(plData.netProfit)}
              accent={plData.netProfit >= 0 ? "success" : "destructive"}
            />
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/40">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Expense Breakdown by Category
              </p>
            </div>
            <div className="divide-y divide-border">
              {Object.entries(plData.byCategory)
                .filter(([, amt]) => amt > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amt]) => (
                  <div key={cat} className="flex justify-between px-4 py-2.5">
                    <span className="text-sm text-foreground">{cat}</span>
                    <span className="text-sm font-medium text-foreground tabular-nums">{fmt(amt)}</span>
                  </div>
                ))}
              {Object.values(plData.byCategory).every((v) => v === 0) && (
                <div className="px-4 py-8 text-center text-muted-foreground text-sm">No expenses in this period</div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ══════════ ANNUAL TAX SUMMARY ══════════ */}
        <TabsContent value="tax" className="space-y-5">
          {/* Filters + Export dropdown */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Company</label>
              <Select value={taxCompany} onValueChange={setTaxCompany}>
                <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companyNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tax Year</label>
              <Select value={taxYear} onValueChange={setTaxYear}>
                <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 ml-auto">
                  <Download className="h-3.5 w-3.5" /> Export <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs">Export Format</DropdownMenuLabel>
                <DropdownMenuItem onClick={exportTaxCSV}>
                  <FileText className="h-3.5 w-3.5 mr-2" /> CSV Export
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportTaxPDF}>
                  <FileText className="h-3.5 w-3.5 mr-2" /> Tax Prep PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={includeAppendix}
                  onCheckedChange={(v) => setIncludeAppendix(!!v)}
                  onSelect={(e) => e.preventDefault()}
                >
                  Include detailed transaction appendix
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Top-level summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Total Gross Income" value={fmt(incomeSummary.total)} accent="primary" />
            <SummaryCard label="Business Net Profit" value={fmt(taxData.netProfit)} accent={taxData.netProfit >= 0 ? "success" : "destructive"} />
            <SummaryCard label="Estimated Tax Liability" value={fmt(taxSummary.totalLiability)} />
            <SummaryCard label="Remaining Liability" value={fmt(taxSummary.remaining)} accent={taxSummary.remaining > 0 ? "destructive" : "success"} />
          </div>

          {/* Section 1 — Income Summary */}
          <SectionCard title="1. Income Summary" subtitle={`All income sources for ${taxYear}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <KVRow label="W-2 Income" value={fmt(incomeSummary.w2)} />
              <KVRow label="1099 Income" value={fmt(incomeSummary.income1099)} />
              <KVRow label="K-1 Income" value={fmt(incomeSummary.k1)} />
              <KVRow label="Investment Income (capital gains)" value={fmt(incomeSummary.investment)} />
              <KVRow label="Interest Income" value={fmt(incomeSummary.interest)} />
              <KVRow label="Dividend Income" value={fmt(incomeSummary.dividend)} />
            </div>
            <div className="mt-3 pt-3 border-t border-border flex justify-between">
              <span className="text-sm font-semibold text-foreground">Total Gross Income</span>
              <span className="text-base font-bold text-primary tabular-nums">{fmt(incomeSummary.total)}</span>
            </div>
          </SectionCard>

          {/* Section 2 — Business Summary (Schedule C, collapsible) */}
          <SectionCard title="2. Business Summary" subtitle="Schedule C — gross receipts, IRS expense categories, net profit">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <SummaryCard label="Gross Receipts" value={fmt(taxData.grossIncome)} />
              <SummaryCard label="Total Expenses" value={fmt(taxData.totalExpenses)} />
              <SummaryCard
                label="Net Profit / Loss"
                value={fmt(taxData.netProfit)}
                accent={taxData.netProfit >= 0 ? "success" : "destructive"}
              />
            </div>
            <Collapsible open={scheduleCOpen} onOpenChange={setScheduleCOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${scheduleCOpen ? "rotate-180" : ""}`}
                  />
                  {scheduleCOpen ? "Hide" : "Show"} Schedule C Worksheet
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/30 border-b border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Part I — Income
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-sm">1. Gross receipts or sales</span>
                      <span className="text-sm font-semibold tabular-nums">{fmt(taxData.grossIncome)}</span>
                    </div>
                  </div>
                  <div className="px-4 py-2 bg-muted/30 border-y border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Part II — Expenses
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {EXPENSE_CATEGORIES.map((cat, i) => {
                      const amt = taxData.byCategory[cat] || 0;
                      return (
                        <div key={cat} className={`flex justify-between px-4 py-1.5 ${amt === 0 ? "opacity-50" : ""}`}>
                          <span className="text-sm">{i + 8}. {cat}</span>
                          <span className="text-sm tabular-nums">{amt > 0 ? fmt(amt) : "—"}</span>
                        </div>
                      );
                    })}
                    {taxData.homeOfficeDeduction > 0 && (
                      <div className="flex justify-between px-4 py-1.5">
                        <span className="text-sm">{HOME_OFFICE_REPORT_LABEL}</span>
                        <span className="text-sm tabular-nums">{fmt(taxData.homeOfficeDeduction)}</span>
                      </div>
                    )}
                  </div>
                  <div className="divide-y divide-border border-t border-border bg-muted/10">
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-sm font-semibold">Total Expenses</span>
                      <span className="text-sm font-bold tabular-nums">{fmt(taxData.totalExpenses)}</span>
                    </div>
                    <div className="flex justify-between px-4 py-2.5">
                      <span className="text-sm font-bold">Net Profit / Loss</span>
                      <span
                        className={`text-base font-bold tabular-nums ${
                          taxData.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                        }`}
                      >
                        {fmt(taxData.netProfit)}
                      </span>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </SectionCard>

          {/* Section 3 — Deductions Summary */}
          <SectionCard title="3. Deductions Summary" subtitle="Above-the-line and tax-tracked deductions">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <KVRow label="HSA Contributions" value={fmt(deductions.hsa)} />
              <KVRow label="401(k) / Retirement Contributions" value={fmt(deductions.retirement401k)} />
              <KVRow label="Mileage Deduction" value={fmt(deductions.mileage)} />
              <KVRow label="Home Office Deduction" value={fmt(deductions.homeOffice)} />
              <KVRow label="Healthcare Deduction" value={fmt(deductions.healthcare)} />
            </div>
            <div className="mt-3 pt-3 border-t border-border flex justify-between">
              <span className="text-sm font-semibold text-foreground">Total Deductions</span>
              <span className="text-base font-bold text-foreground tabular-nums">
                {fmt(
                  deductions.hsa +
                    deductions.retirement401k +
                    deductions.mileage +
                    deductions.homeOffice +
                    deductions.healthcare,
                )}
              </span>
            </div>
          </SectionCard>

          {/* Section 4 — Tax Summary */}
          <SectionCard title="4. Tax Summary" subtitle="From the in-app tax engine">
            {!taxSummary.available ? (
              <p className="text-sm text-muted-foreground">
                Tax engine estimates are only available for the current tax year ({currentYear}).
                Payments and reserve totals for {taxYear} are shown below.
              </p>
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <KVRow label="Federal Tax Estimate" value={fmt(taxSummary.federal)} />
              <KVRow label="State Tax Estimate" value={fmt(taxSummary.state)} />
              <KVRow label="Self-Employment Tax Estimate" value={fmt(taxSummary.selfEmployment)} />
              <KVRow label="Estimated Annual Tax Liability" value={fmt(taxSummary.totalLiability)} bold />
              <KVRow label="Taxes Already Withheld" value={fmt(taxSummary.withheld)} accent="success" />
              <KVRow label="Tax Reserve Saved" value={fmt(taxSummary.reserveSaved)} accent="success" />
              <KVRow label="Quarterly Payments Made" value={fmt(taxSummary.paymentsMade)} accent="success" />
              <KVRow label="Remaining Estimated Liability" value={fmt(taxSummary.remaining)} bold accent={taxSummary.remaining > 0 ? "destructive" : "success"} />
            </div>
          </SectionCard>

          {/* Section 5 — Quarterly Tax Summary */}
          <SectionCard title="5. Quarterly Tax Summary" subtitle="Recommended estimated payments by quarter">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-2 font-medium">Quarter</th>
                    <th className="text-right py-2 font-medium">Recommended</th>
                    <th className="text-right py-2 font-medium">Paid</th>
                    <th className="text-right py-2 font-medium">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {quarterly.map((q) => (
                    <tr key={q.quarter} className="border-b border-border last:border-0">
                      <td className="py-2.5 font-medium text-foreground">{q.quarter}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmt(q.recommended)}</td>
                      <td className="py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {q.paid !== undefined ? fmt(q.paid) : "—"}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {q.remaining !== undefined ? fmt(q.remaining) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <p className="text-xs text-muted-foreground text-center">
            Tax-prep worksheet for reference — not an official IRS form. Use alongside Schedule C and your tax pro when filing.
            {taxSettings?.stateIncomeTaxEnabled === false && (
              <> · State tax not enabled in Tax Profile.</>
            )}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
