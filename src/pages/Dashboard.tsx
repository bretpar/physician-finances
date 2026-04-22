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
import QuarterlyTracker, { type WithholdingBreakdown } from "@/components/dashboard/QuarterlyTracker";
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
  const { estimate, isLoading: estLoading } = useTaxEstimate();
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

  // ── Per-source withholding split (W-2 personal / W-2 business / K-1 / 1099) ──
  // Source of truth:
  //   • Business income_entries (linked to a live transaction) → bucketed by
  //     the entry's filing type (or its company's filing type as fallback).
  //   • Personal income entries → always personal-W-2 bucket (they're W-2-style
  //     paychecks for the user/partner).
  //   • Quarterly payments → only those tagged to the CURRENT quarter count.
  //
  // Withholding = federal_withholding + state_withholding (both fields exist on
  // income_entries). This matches what flows into the tax engine.
  const q = useMemo(() => getCurrentQuarter(now), [now]);
  const withholding: WithholdingBreakdown = useMemo(() => {
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const liveTxIds = new Set(
      (transactions || []).filter((t) => t.transaction_type === "income").map((t) => t.id),
    );

    let businessW2 = 0;
    let k1 = 0;
    let scheduleC1099 = 0;

    for (const e of incomeEntries || []) {
      // Only count business entries that are still tied to a live transaction —
      // mirrors useTaxEstimate's reconciliation so we don't double-count orphans.
      if (!e.linked_transaction_id || !liveTxIds.has(e.linked_transaction_id)) continue;
      const wh = Number((e as any).federal_withholding || 0) + Number((e as any).state_withholding || 0);
      if (wh <= 0) continue;

      // Resolve filing type: prefer the entry's, fall back to its company.
      const company = (e as any).source_id ? companyById.get((e as any).source_id) : undefined;
      const filing = normalizeFilingType(e.income_type || company?.companyType);
      if (filing === "scorp_w2" || filing === "w2") businessW2 += wh;
      else if (filing === "k1_partnership") k1 += wh;
      else if (filing === "1099_schedule_c") scheduleC1099 += wh;
      // scorp_distribution and "other" are intentionally not bucketed — their
      // withholdings (rare) flow through estimate but don't fit the W-2/K-1/1099
      // grouping the user expects to see.
    }

    const personalW2 = (personalEntries || []).reduce(
      (s, e) =>
        s + Number(e.federal_withholding || 0) + Number((e as any).state_withholding || 0),
      0,
    );

    const quarterlyPayments = getQuarterPayments(payments, q.label);

    return { personalW2, businessW2, k1, scheduleC1099, quarterlyPayments };
  }, [incomeEntries, personalEntries, transactions, companies, payments, q.label]);

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

  const annualTaxLiability = estimate?.totalTaxLiability ?? 0;
  const greeting =
    user?.user_metadata?.first_name ||
    (user?.email ? user.email.split("@")[0] : "back");

  // Mirror the tracker's math so the score stays consistent with what the user sees.
  const totalWithholdingYTD =
    withholding.personalW2 + withholding.businessW2 + withholding.k1 + withholding.scheduleC1099;
  const quarterTarget = Math.max(0, (annualTaxLiability * q.quarter) / 4);
  const quarterSaved =
    (totalWithholdingYTD * q.quarter) / 4 + withholding.quarterlyPayments;
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
        withholding={withholding}
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
