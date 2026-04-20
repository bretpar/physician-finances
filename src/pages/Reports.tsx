import { useState, useMemo } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useCompanies } from "@/contexts/CompanyContext";
import { useMileageYTD, IRS_MILEAGE_RATE } from "@/hooks/useMileage";
import { mapLegacyCategory, EXPENSE_CATEGORIES } from "@/components/ExpenseCategoryCombobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, FileText, Building2 } from "lucide-react";

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
  const { companies } = useCompanies();
  const currentYearForMileage = new Date().getFullYear();
  const { data: ytdMileage = [] } = useMileageYTD(currentYearForMileage);

  const VEHICLE_CATEGORY = "Car and truck expenses";

  // Resolve a mileage entry to a company NAME (Reports filters by entity name).
  // Entries with no company_id are skipped — they never count toward any company total.
  const mileageByCompanyName = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of ytdMileage) {
      if (!e.company_id) continue;
      const c = companies.find((x) => x.id === e.company_id);
      if (!c) continue;
      const dollars = Number(e.miles) * IRS_MILEAGE_RATE;
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

  const dateRange = useMemo(() => {
    if (quickRange === "custom") return { from: customFrom, to: customTo };
    return getDateRange(quickRange);
  }, [quickRange, customFrom, customTo]);

  // ──── P&L Computation ────
  const plData = useMemo(() => {
    const expenseTxs = transactions.filter((t) => {
      if (t.transaction_type !== "expense") return false;
      if ((t as any).excluded_from_reports) return false;
      if (plCompany !== "all" && t.entity !== plCompany) return false;
      if (dateRange.from && t.transaction_date < dateRange.from) return false;
      if (dateRange.to && t.transaction_date > dateRange.to) return false;
      return true;
    });

    const incomeTxs = transactions.filter((t) => {
      if (t.transaction_type !== "income") return false;
      if ((t as any).excluded_from_reports) return false;
      if (plCompany !== "all" && t.entity !== plCompany) return false;
      if (dateRange.from && t.transaction_date < dateRange.from) return false;
      if (dateRange.to && t.transaction_date > dateRange.to) return false;
      return true;
    });

    const grossIncome = incomeTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const txExpenseTotal = expenseTxs.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Mileage deduction allocated to selected company (or all assigned mileage)
    let mileageDed = 0;
    if (plCompany === "all") {
      for (const v of mileageByCompanyName.values()) mileageDed += v;
    } else {
      mileageDed = mileageByCompanyName.get(plCompany) || 0;
    }
    const totalExpenses = txExpenseTotal + mileageDed;

    // Category breakdown — fold mileage into "Car and truck expenses"
    const byCategory: Record<string, number> = {};
    for (const t of expenseTxs) {
      const cat = mapLegacyCategory(t.category);
      byCategory[cat] = (byCategory[cat] || 0) + Math.abs(t.amount);
    }
    if (mileageDed > 0) {
      byCategory[VEHICLE_CATEGORY] = (byCategory[VEHICLE_CATEGORY] || 0) + mileageDed;
    }

    return { grossIncome, totalExpenses, mileageDeduction: mileageDed, netProfit: grossIncome - totalExpenses, byCategory, expenseTxs, incomeTxs };
  }, [transactions, plCompany, dateRange, mileageByCompanyName]);

  // ──── Annual Tax Summary Computation ────
  const taxData = useMemo(() => {
    const yearStart = `${taxYear}-01-01`;
    const yearEnd = `${taxYear}-12-31`;

    const expenseTxs = transactions.filter((t) => {
      if (t.transaction_type !== "expense") return false;
      if ((t as any).excluded_from_reports) return false;
      if (taxCompany !== "all" && t.entity !== taxCompany) return false;
      return t.transaction_date >= yearStart && t.transaction_date <= yearEnd;
    });

    const incomeTxs = transactions.filter((t) => {
      if (t.transaction_type !== "income") return false;
      if ((t as any).excluded_from_reports) return false;
      if (taxCompany !== "all" && t.entity !== taxCompany) return false;
      return t.transaction_date >= yearStart && t.transaction_date <= yearEnd;
    });

    const grossIncome = incomeTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const txExpenseTotal = expenseTxs.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Mileage deduction → folded into "Car and truck expenses" Schedule C bucket
    let mileageDed = 0;
    if (taxCompany === "all") {
      for (const v of mileageByCompanyName.values()) mileageDed += v;
    } else {
      mileageDed = mileageByCompanyName.get(taxCompany) || 0;
    }
    const totalExpenses = txExpenseTotal + mileageDed;

    const byCategory: Record<string, number> = {};
    for (const cat of EXPENSE_CATEGORIES) byCategory[cat] = 0;
    for (const t of expenseTxs) {
      const cat = mapLegacyCategory(t.category);
      byCategory[cat] = (byCategory[cat] || 0) + Math.abs(t.amount);
    }
    byCategory[VEHICLE_CATEGORY] = (byCategory[VEHICLE_CATEGORY] || 0) + mileageDed;

    return { grossIncome, totalExpenses, mileageDeduction: mileageDed, netProfit: grossIncome - totalExpenses, byCategory };
  }, [transactions, taxCompany, taxYear, mileageByCompanyName]);

  // ──── Export helpers ────
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
    let csv = `Annual Tax Summary - Schedule C Style\nCompany,${companyLabel}\nTax Year,${taxYear}\n\n`;
    csv += `INCOME\nGross Receipts/Sales,${taxData.grossIncome}\n\n`;
    csv += `EXPENSES\nCategory,Annual Total\n`;
    for (const cat of EXPENSE_CATEGORIES) {
      csv += `"${cat}",${taxData.byCategory[cat] || 0}\n`;
    }
    csv += `\nTotal Expenses,${taxData.totalExpenses}\nNet Profit/Loss,${taxData.netProfit}\n`;
    downloadBlob(csv, `tax-summary-${taxYear}.csv`);
  }

  function downloadBlob(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-foreground">Reports</h1>

      <Tabs defaultValue="pnl" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pnl" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Profit & Loss</TabsTrigger>
          <TabsTrigger value="tax" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Annual Tax Summary</TabsTrigger>
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
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs w-[130px]" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs w-[130px]" />
              </div>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={exportPLCSV}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Gross Income</p>
              <p className="text-lg font-semibold text-foreground">{fmt(plData.grossIncome)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Expenses</p>
              <p className="text-lg font-semibold text-foreground">{fmt(plData.totalExpenses)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Net Profit / Loss</p>
              <p className={`text-lg font-semibold ${plData.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                {fmt(plData.netProfit)}
              </p>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/40">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Expense Breakdown by Category</p>
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
        <TabsContent value="tax" className="space-y-4">
          {/* Filters */}
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
            <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={exportTaxCSV}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>

          {/* Schedule C-style worksheet */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border bg-muted/30">
              <h2 className="text-base font-semibold text-foreground">Schedule C Tax Worksheet</h2>
              <div className="flex gap-6 mt-1">
                <p className="text-xs text-muted-foreground">Company: <span className="font-medium text-foreground">{taxCompany === "all" ? "All Companies" : taxCompany}</span></p>
                <p className="text-xs text-muted-foreground">Tax Year: <span className="font-medium text-foreground">{taxYear}</span></p>
              </div>
            </div>

            {/* Income section */}
            <div className="border-b border-border">
              <div className="px-6 py-2 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Part I — Income</p>
              </div>
              <div className="divide-y divide-border">
                <div className="flex justify-between px-6 py-2.5">
                  <span className="text-sm text-foreground">1. Gross receipts or sales</span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">{fmt(taxData.grossIncome)}</span>
                </div>
                <div className="flex justify-between px-6 py-2.5 bg-muted/10">
                  <span className="text-sm font-semibold text-foreground">Total Income</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">{fmt(taxData.grossIncome)}</span>
                </div>
              </div>
            </div>

            {/* Expenses section */}
            <div className="border-b border-border">
              <div className="px-6 py-2 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Part II — Expenses</p>
              </div>
              <div className="divide-y divide-border">
                {EXPENSE_CATEGORIES.map((cat, i) => {
                  const amt = taxData.byCategory[cat] || 0;
                  return (
                    <div key={cat} className={`flex justify-between px-6 py-2 ${amt === 0 ? "opacity-50" : ""}`}>
                      <span className="text-sm text-foreground">{i + 8}. {cat}</span>
                      <span className="text-sm tabular-nums text-foreground">{amt > 0 ? fmt(amt) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div>
              <div className="px-6 py-2 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Summary</p>
              </div>
              <div className="divide-y divide-border">
                <div className="flex justify-between px-6 py-2.5">
                  <span className="text-sm font-semibold text-foreground">Total Expenses</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">{fmt(taxData.totalExpenses)}</span>
                </div>
                <div className="flex justify-between px-6 py-3 bg-muted/10">
                  <span className="text-sm font-bold text-foreground">Net Profit / Loss</span>
                  <span className={`text-base font-bold tabular-nums ${taxData.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                    {fmt(taxData.netProfit)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            This is a tax-prep worksheet for reference — not an official IRS form. Use alongside Schedule C when filing.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
