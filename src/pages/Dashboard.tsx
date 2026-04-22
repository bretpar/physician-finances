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
import MoneyCards from "@/components/dashboard/MoneyCards";
import QuarterlyTracker, { type CompanyWithholdingRow } from "@/components/dashboard/QuarterlyTracker";
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

  // ── Per-COMPANY withholding aggregation (W-2 + K-1 + 1099 grouped by company) ──
  // Source of truth:
  //   • Business income_entries (linked to a live transaction) → grouped by their
  //     resolved company (source_id → companies, fallback to entry.company name).
  //   • Personal income entries → grouped by their `company` field (employer name).
  //   • Quarterly payments → only those tagged to the CURRENT quarter count.
  //
  // Withholding = federal_withholding + state_withholding.
  const q = useMemo(() => getCurrentQuarter(now), [now]);

  const companyRows: CompanyWithholdingRow[] = useMemo(() => {
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const liveTxIds = new Set(
      (transactions || []).filter((t) => t.transaction_type === "income").map((t) => t.id),
    );

    // key → { label, amount }
    const buckets = new Map<string, { label: string; amount: number }>();
    const addTo = (key: string, label: string, amount: number) => {
      if (amount <= 0) return;
      const existing = buckets.get(key);
      if (existing) existing.amount += amount;
      else buckets.set(key, { label, amount });
    };

    const filingHint = (filing: string | undefined): string => {
      if (filing === "scorp_w2" || filing === "w2") return "W-2";
      if (filing === "k1_partnership") return "K-1";
      if (filing === "1099_schedule_c") return "1099";
      return "";
    };

    // Business entries → grouped by company id (fallback: entry.company name)
    for (const e of incomeEntries || []) {
      if (!e.linked_transaction_id || !liveTxIds.has(e.linked_transaction_id)) continue;
      const wh =
        Number((e as any).federal_withholding || 0) + Number((e as any).state_withholding || 0);
      if (wh <= 0) continue;

      const company = (e as any).source_id ? companyById.get((e as any).source_id) : undefined;
      const filing = normalizeFilingType(e.income_type || company?.companyType);
      const hint = filingHint(filing);
      const name = company?.name || e.company || "Unassigned";
      const key = company?.id || `name:${name.toLowerCase().trim()}`;
      const label = hint ? `${name} (${hint})` : name;
      addTo(key, label, wh);
    }

    // Personal entries → grouped by employer name (W-2)
    for (const e of personalEntries || []) {
      const wh =
        Number(e.federal_withholding || 0) + Number((e as any).state_withholding || 0);
      if (wh <= 0) continue;
      const name = (e.company || "Personal W-2").trim() || "Personal W-2";
      const key = `personal:${name.toLowerCase()}`;
      addTo(key, `${name} (W-2)`, wh);
    }

    return Array.from(buckets.entries()).map(([key, v]) => ({
      key,
      label: v.label,
      amount: v.amount,
    }));
  }, [incomeEntries, personalEntries, transactions, companies]);

  const quarterlyPayments = useMemo(
    () => getQuarterPayments(payments, q.label),
    [payments, q.label],
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

  // Mirror the tracker's math so the score stays consistent with what the user sees.
  const totalWithholdingYTD = companyRows.reduce((s, c) => s + c.amount, 0);
  const quarterTarget = Math.max(0, (annualTaxLiability * q.quarter) / 4);
  const quarterSaved =
    (totalWithholdingYTD * q.quarter) / 4 + quarterlyPayments;
  const taxProgressPct = quarterTarget > 0 ? (quarterSaved / quarterTarget) * 100 : 100;
  const remainingTaxThisQuarter = Math.max(0, quarterTarget - quarterSaved);

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <header className="px-1">
        <h1 className="text-xl font-semibold">Welcome back, {greeting}</h1>
        <p className="text-sm text-muted-foreground">Here's your money at a glance.</p>
      </header>

      <MoneyCards
        totalEarnedYTD={summary.totalIncome}
        earnedThisMonth={earnedThisMonth}
        estimatedTax={annualTaxLiability}
        userId={user?.id}
      />

      <QuarterlyTracker
        annualTaxLiability={annualTaxLiability}
        companies={companyRows}
        quarterlyPayments={quarterlyPayments}
        methodLabel={methodLabel}
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
