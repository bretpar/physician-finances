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
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks } from "@/hooks/useProjectedIncome";
import DashboardMetrics from "@/components/dashboard/DashboardMetrics";
import QuarterlyTracker from "@/components/dashboard/QuarterlyTracker";
import FinancialScore from "@/components/dashboard/FinancialScore";
import PaycheckConfetti from "@/components/dashboard/PaycheckConfetti";
import { useQuarterlyEstimator } from "@/hooks/useQuarterlyEstimator";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: payments = [] } = useTaxPayments();
  const { actualEstimate, forecastEstimate, isLoading: estLoading } = useTaxEstimate();
  const { companies } = useCompanies();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const summary = useDashboardSummary(transactions, rates, incomeEntries, personalEntries);

  const projectedPaychecks = useMemo(
    () =>
      generateProjectedPaychecks(streams || [], bonuses || [], incomeEntries).map((p) => ({
        date: p.date,
        grossAmount: Number(p.grossAmount || 0),
      })),
    [streams, bonuses, incomeEntries],
  );

  const now = useMemo(() => new Date(), []);
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Income consistency: months YTD with at least one income event.
  const { monthsWithIncome, monthsElapsed } = useMemo(() => {
    const elapsed = currentMonth + 1;
    const seen = new Set<number>();
    for (const t of transactions || []) {
      if (t.transaction_type !== "income") continue;
      if (isExcludedFromBusiness(t as any)) continue;
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
      .filter((t) => t.transaction_type === "income" && !isExcludedFromBusiness(t as any))
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
  // - flat_estimate → manual % × actual income base
  // - dynamic_*     → forecast/canonical actual + planned tax profile
  const method = rates?.withholdingMethod ?? "dynamic_actual";
  const baseEstimate =
    method === "flat_estimate" ? actualEstimate : (forecastEstimate ?? actualEstimate);
  const profile = getSelectedWithholdingProfileRate({ taxSettings: rates, actualEstimate, forecastEstimate });
  const personalRate = getSavingsRateForIncomeBucket({
    incomeBucket: "personal",
    incomeType: "W2",
    taxSettings: rates,
    actualEstimate,
    forecastEstimate,
  }).rate;
  const businessRate = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "1099",
    taxSettings: rates,
    actualEstimate,
    forecastEstimate,
    includeSETaxInRecommendation: true,
  }).rate;
  const annualTaxLiability = Math.max(0, Number(baseEstimate?.totalTaxLiability || 0));
  const methodLabel = profile.label;
  const effectiveTaxRate = method === "flat_estimate" ? profile.federalProfileRate : profile.canonicalEffectiveTaxRate;

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
        quarterMethod={rates?.quarterlyTrackerMethod ?? "even"}
        projectedPaychecks={projectedPaychecks}
        personalBucketRate={personalRate}
        businessBucketRate={businessRate}
        effectiveTaxRate={effectiveTaxRate}
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
