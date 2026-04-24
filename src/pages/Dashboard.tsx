import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { useCompanies } from "@/contexts/CompanyContext";
import DashboardMetrics from "@/components/dashboard/DashboardMetrics";
import QuarterlyTracker from "@/components/dashboard/QuarterlyTracker";
import FinancialScore from "@/components/dashboard/FinancialScore";
import PaycheckConfetti from "@/components/dashboard/PaycheckConfetti";
import { getCurrentQuarter, getQuarterPayments } from "@/lib/quarters";
import { normalizeFilingType } from "@/lib/filingTypes";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: payments = [] } = useTaxPayments();
  const { actualEstimate, forecastEstimate, isLoading: estLoading } = useTaxEstimate();
  const { companies } = useCompanies();
  const summary = useDashboardSummary(transactions, rates, incomeEntries, personalEntries);

  const now = useMemo(() => new Date(), []);
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // "+ this month" — sum of business income (transactions) + personal income entries dated in current month.
  const earnedThisMonth = useMemo(() => {
    const inMonth = (iso: string) => {
      const d = new Date(iso);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    };
    const business = (transactions || [])
      .filter((t) => t.transaction_type === "income" && inMonth(t.transaction_date))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const personal = (personalEntries || [])
      .filter((e) => inMonth(e.income_date))
      .reduce((s, e) => s + Number(e.gross_amount || 0), 0);
    return business + personal;
  }, [transactions, personalEntries, currentMonth, currentYear]);

  // ── Per-COMPANY CURRENT-QUARTER paid vs saved ────────────────────────────
  // Paid  = federal_withholding + state_withholding on income dated this quarter
  // Saved = actual_withholding (transaction reserves) + additional_tax_reserve
  //         on income dated this quarter (not yet submitted to IRS/state)
  const q = useMemo(() => getCurrentQuarter(now), [now]);

  // Quarter date range: start of quarter month → deadline date.
  const quarterRange = useMemo(() => {
    const year = now.getFullYear();
    const startMonthByQ: Record<number, number> = { 1: 0, 2: 3, 3: 5, 4: 8 };
    const start = new Date(year, startMonthByQ[q.quarter], 1);
    // End is the deadline (exclusive next-day). Use deadline + 1 day as upper bound.
    const end = new Date(q.deadline);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, [now, q.quarter, q.deadline]);

  const inQuarter = (iso: string) => {
    const d = new Date(iso);
    return d >= quarterRange.start && d < quarterRange.end;
  };

  const companyRows: CompanyQuarterRow[] = useMemo(() => {
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const liveTxById = new Map(
      (transactions || [])
        .filter((t) => t.transaction_type === "income")
        .map((t) => [t.id, t] as const),
    );

    // key → { label, paid, saved }
    const buckets = new Map<string, { label: string; paid: number; saved: number }>();
    const ensure = (key: string, label: string) => {
      let row = buckets.get(key);
      if (!row) {
        row = { label, paid: 0, saved: 0 };
        buckets.set(key, row);
      }
      return row;
    };

    const filingHint = (filing: string | undefined): string => {
      if (filing === "scorp_w2" || filing === "w2") return "W-2";
      if (filing === "k1_partnership") return "K-1";
      if (filing === "1099_schedule_c") return "1099";
      return "";
    };

    // Business income entries (linked to a live transaction) → bucket per company
    for (const e of incomeEntries || []) {
      if (!e.linked_transaction_id) continue;
      const tx = liveTxById.get(e.linked_transaction_id);
      if (!tx) continue;
      // Filter by CURRENT quarter using the income date
      if (!inQuarter(e.income_date)) continue;

      // `federal_withholding` is the canonical "Total Federal Payroll Taxes"
      // (federal income tax + SS + Medicare). State is tracked separately and
      // is intentionally NOT included in quarterly federal progress.
      const paid = Number((e as any).federal_withholding || 0);
      const saved =
        Number((tx as any).actual_withholding || 0) +
        Number((e as any).additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;

      const company = (e as any).source_id ? companyById.get((e as any).source_id) : undefined;
      const filing = normalizeFilingType(e.income_type || company?.companyType);
      const hint = filingHint(filing);
      const name = company?.name || e.company || "Unassigned";
      const key = company?.id || `name:${name.toLowerCase().trim()}`;
      const label = hint ? `${name} (${hint})` : name;
      const row = ensure(key, label);
      row.paid += paid;
      row.saved += saved;
    }

    // Personal income entries (W-2) → bucket per employer name
    for (const e of personalEntries || []) {
      if (!inQuarter(e.income_date)) continue;
      // Federal-only at this time (state tracked separately).
      const paid = Number(e.federal_withholding || 0);
      const saved = Number((e as any).additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;
      const name = (e.company || "Personal W-2").trim() || "Personal W-2";
      const key = `personal:${name.toLowerCase()}`;
      const row = ensure(key, `${name} (W-2)`);
      row.paid += paid;
      row.saved += saved;
    }

    return Array.from(buckets.entries()).map(([key, v]) => ({
      key,
      label: v.label,
      paid: v.paid,
      saved: v.saved,
    }));
  }, [incomeEntries, personalEntries, transactions, companies, quarterRange]);

  const quarterlyPayments = useMemo(
    () => getQuarterPayments(payments, q.label, currentYear),
    [payments, q.label, currentYear],
  );

  // Income consistency: months YTD with at least one income event.
  const { monthsWithIncome, monthsElapsed } = useMemo(() => {
    const elapsed = currentMonth + 1;
    const seen = new Set<number>();
    for (const t of transactions || []) {
      if (t.transaction_type !== "income") continue;
      const d = new Date(t.transaction_date);
      if (d.getFullYear() === currentYear) seen.add(d.getMonth());
    }
    for (const e of personalEntries || []) {
      const d = new Date(e.income_date);
      if (d.getFullYear() === currentYear) seen.add(d.getMonth());
    }
    return { monthsWithIncome: seen.size, monthsElapsed: elapsed };
  }, [transactions, personalEntries, currentMonth, currentYear]);

  // Activity: transactions in the last 30 days.
  const recentTxCount = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return (transactions || []).filter((t) => new Date(t.transaction_date).getTime() >= cutoff).length;
  }, [transactions]);

  // Recent income for the confetti detector.
  const recentIncome = useMemo(() => {
    const fromTx = (transactions || [])
      .filter((t) => t.transaction_type === "income")
      .map((t) => ({ id: t.id, amount: Math.abs(t.amount), date: t.transaction_date }));
    const fromPersonal = (personalEntries || []).map((e) => ({
      id: e.id,
      amount: Number(e.gross_amount || 0),
      date: e.income_date,
    }));
    return [...fromTx, ...fromPersonal];
  }, [transactions, personalEntries]);

  if (txLoading || ratesLoading || incLoading || piLoading || estLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // ── Choose annual liability based on the user's withholding method ────────
  // - flat_estimate   → manual % × forecast (or actual fallback) total income
  // - dynamic_planner → forecastEstimate.totalTaxLiability (actual + projected)
  // - dynamic_actual  → actualEstimate.totalTaxLiability   (actual only) [default]
  const method = rates?.withholdingMethod ?? "dynamic_actual";
  const baseEstimate =
    method === "dynamic_planner" ? (forecastEstimate ?? actualEstimate) : actualEstimate;
  let annualTaxLiability = baseEstimate?.totalTaxLiability ?? 0;
  let methodLabel = "Dynamic (actual income)";
  if (method === "dynamic_planner") {
    methodLabel = "Dynamic (actual + projected)";
  } else if (method === "flat_estimate") {
    const ratePct = Number(rates?.manualEffectiveTaxRate ?? 0);
    const incomeBase =
      (forecastEstimate ?? actualEstimate)?.totalIncome ??
      actualEstimate?.totalIncome ??
      0;
    annualTaxLiability = incomeBase * (ratePct / 100);
    methodLabel = `Flat estimate (${ratePct}%)`;
  }

  const greeting =
    user?.user_metadata?.first_name ||
    (user?.email ? user.email.split("@")[0] : "back");

  // Mirror the tracker's math (CURRENT QUARTER ONLY) so the score stays consistent.
  const quarterGoal = Math.max(0, annualTaxLiability / 4);
  const paidThisQuarter =
    companyRows.reduce((s, c) => s + c.paid, 0) + quarterlyPayments;
  const rawSavedThisQuarter = companyRows.reduce((s, c) => s + c.saved, 0);
  const savedThisQuarter = Math.max(0, rawSavedThisQuarter - quarterlyPayments);
  const progressThisQuarter = paidThisQuarter + savedThisQuarter;
  const taxProgressPct = quarterGoal > 0 ? (progressThisQuarter / quarterGoal) * 100 : 100;
  const remainingTaxThisQuarter = Math.max(0, quarterGoal - progressThisQuarter);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header className="px-1 pb-1">
        <h1 className="text-lg font-medium text-foreground/90">Welcome back, {greeting}</h1>
        <p className="text-xs text-muted-foreground/80">Here's your money at a glance.</p>
      </header>

      <DashboardMetrics
        totalIncomeYTD={summary.totalIncome}
        businessProfitYTD={summary.businessNetIncome}
      />

      <QuarterlyTracker
        annualTaxLiability={annualTaxLiability}
        payments={payments}
        methodLabel={methodLabel}
        incomeEntries={incomeEntries || []}
        personalEntries={personalEntries || []}
        transactions={transactions || []}
        companies={companies}
      />

      <FinancialScore
        taxProgressPct={taxProgressPct}
        monthsWithIncome={monthsWithIncome}
        monthsElapsed={monthsElapsed}
        recentTxCount={recentTxCount}
        remainingTaxThisQuarter={remainingTaxThisQuarter}
        userId={user?.id}
      />

      <PaycheckConfetti userId={user?.id} recentIncome={recentIncome} />
    </div>
  );
}
