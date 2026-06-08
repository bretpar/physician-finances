import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { aggregateInvestmentTaxBuckets, useInvestmentIncomeEntries } from "@/hooks/useInvestmentIncome";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { useCompanies } from "@/contexts/CompanyContext";
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks, getMonthlyPlannerBreakdown, useStreamOverrides, usePlannerConversions } from "@/hooks/useProjectedIncome";
import QuarterlyTracker from "@/components/dashboard/QuarterlyTracker";
import DashboardQuarterlyPaymentCallout from "@/components/dashboard/QuarterlyPaymentCallout";
import FinancialScore from "@/components/dashboard/FinancialScore";
import PaycheckConfetti from "@/components/dashboard/PaycheckConfetti";
import IncomeModeToggle from "@/components/dashboard/IncomeModeToggle";
import AnnualIncomeHero from "@/components/dashboard/AnnualIncomeHero";
import IncomeBreakdownCards from "@/components/dashboard/IncomeBreakdownCards";
import MonthlyIncomeCard, { type MonthBreakdown } from "@/components/dashboard/MonthlyIncomeCard";
import DashboardSkeleton from "@/components/dashboard/DashboardSkeleton";

import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";
import { normalizeFilingType } from "@/lib/filingTypes";

import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";
import { deriveUserTypeFromIncomeStreams, getFeatureAccess } from "@/lib/entitlements";
import { subscriptionTierToEntitlementTier } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: investmentEntries } = useInvestmentIncomeEntries();
  const { data: payments = [] } = useTaxPayments();
  const { data: taxSavings = [] } = useTaxSavings();
  const { actualEstimate, currentPaceEstimate, forecastEstimate, actualDebug, forecastDebug, taxMode, isLoading: estLoading } = useTaxEstimate();
  const { companies } = useCompanies();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();
  const summary = useDashboardSummary(transactions, rates, incomeEntries, personalEntries, investmentEntries);
  const userType = deriveUserTypeFromIncomeStreams(rates?.householdIncomeStreams);
  const isW2Only = userType === "W2_ONLY";
  const featureAccess = getFeatureAccess(userType, subscriptionTierToEntitlementTier(rates?.subscriptionTier));
  const hasLockedDashboardFeatures = featureAccess.advancedTaxOverview.status === "locked" || featureAccess.quarterlyTaxPlanner.status === "locked";
  const [showProfileReviewBanner, setShowProfileReviewBanner] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState<string>("");

  useEffect(() => {
    const dismissed = localStorage.getItem("paycheckmd-household-income-profile-review-dismissed") === "true" || !!rates?.onboardingBannerDismissed;
    setShowProfileReviewBanner(rates?.onboardingComplete == null && !dismissed);
  }, [rates?.onboardingBannerDismissed, rates?.onboardingComplete]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data?.first_name) setProfileFirstName(data.first_name);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Map business income transactions to the matchable shape so projected
  // paychecks tied to business streams correctly tag converted/matched.
  const businessTxsForMatching = useMemo(() => {
    return (transactions || [])
      .filter((t) => t.transaction_type === "income")
      .map((t) => ({
        id: t.id,
        transaction_date: t.transaction_date,
        vendor: (t as any).vendor ?? "",
        amount: Number(t.amount),
        source_id: (t as any).source_id ?? null,
        status: t.status,
        transaction_type: t.transaction_type,
        origin_type: (t as any).origin_type ?? null,
        origin_planner_conversion_id: (t as any).origin_planner_conversion_id ?? null,
      }));
  }, [transactions]);

  // IMPORTANT: pass overrides + planner conversions + business transactions so
  // the chart's "Planned" total uses the same matchStatus tagging as the
  // Income Planner accordion. Without these, converted/skipped/matched
  // occurrences fall back to "active" and inflate chart Planned totals.
  const projectedPaychecks = useMemo(
    () => generateProjectedPaychecks(
      streams || [],
      bonuses || [],
      incomeEntries,
      overrides || [],
      plannerConversions || [],
      businessTxsForMatching,
    ),
    [streams, bonuses, incomeEntries, overrides, plannerConversions, businessTxsForMatching],
  );

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
      .filter((t) => t.transaction_type === "income" && !isExcludedFromBusiness(t as any) && inMonth(t.transaction_date))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const personal = (personalEntries || [])
      .filter((e) => inMonth(e.income_date))
      .reduce((s, e) => s + Number(e.gross_amount || 0), 0);
    const investments = aggregateInvestmentTaxBuckets((investmentEntries || []).filter((e) => inMonth(e.entry_date))).totalTaxableIncome;
    return business + personal + investments;
  }, [transactions, personalEntries, investmentEntries, currentMonth, currentYear]);




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

  const hasIncludedPriorNonW2Income = useMemo(() => {
    return (incomeEntries || []).some((e) => {
      const type = normalizeFilingType(e.income_type);
      return type !== "w2" && type !== "scorp_w2";
    }) || (transactions || []).some((t) => t.transaction_type === "income" && !isExcludedFromBusiness(t as any));
  }, [incomeEntries, transactions]);

  // Hooks below must run unconditionally — keep before any early return to
  // preserve hook order between loading and loaded renders (React error #310).
  const manualSavingsRows = useMemo(
    () => taxSavings.map((s) => ({ savings_date: s.savings_date, amount: Number(s.amount) })),
    [taxSavings],
  );
  const quarterRecommendation = useMemo(
    () => buildQuarterRecommendation({
      annualTaxLiability: Math.max(0, Number(
        ((rates?.withholdingMethod ?? "dynamic_planner") === "dynamic_planner"
          ? (forecastEstimate ?? actualEstimate)
          : (currentPaceEstimate ?? actualEstimate)
        )?.totalTaxLiability || 0,
      )),
      quarterMethod: rates?.quarterlyTrackerMethod ?? "even",
      incomeEntries: incomeEntries || [],
      personalEntries: personalEntries || [],
      transactions: transactions || [],
      investmentEntries: investmentEntries || [],
      projectedPaychecks,
      payments,
      manualSavings: manualSavingsRows,
      now,
    }),
    [rates?.withholdingMethod, rates?.quarterlyTrackerMethod, forecastEstimate, actualEstimate, currentPaceEstimate, incomeEntries, personalEntries, transactions, investmentEntries, projectedPaychecks, payments, manualSavingsRows, now],
  );

  if (txLoading || ratesLoading || incLoading || piLoading || estLoading) {
    return <DashboardSkeleton />;
  }

  // ── Choose annual liability based on the user's withholding method ────────
  // - flat_estimate → manual % × actual income base
  // - dynamic_actual → actual-only tax profile
  // - dynamic_planner → forecast/canonical actual + planned tax profile
  const method = rates?.withholdingMethod ?? "dynamic_planner";
  const baseEstimate =
    method === "dynamic_planner" ? (forecastEstimate ?? actualEstimate) : (currentPaceEstimate ?? actualEstimate);
  const profile = getSelectedWithholdingProfileRate({ taxSettings: rates, actualEstimate, currentPaceEstimate, forecastEstimate });
  const personalRate = getSavingsRateForIncomeBucket({
    incomeBucket: "personal",
    incomeType: "W2",
    taxSettings: rates,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
  }).rate;
  const businessRate = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "1099",
    taxSettings: rates,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
    includeSETaxInRecommendation: true,
  }).rate;
  const annualTaxLiability = Math.max(0, Number(baseEstimate?.totalTaxLiability || 0));
  const methodLabel = profile.label;
  const effectiveTaxRate = method === "flat_estimate" ? profile.federalProfileRate : profile.canonicalEffectiveTaxRate;

  // ── Hero "Total Annual Income" + 4-card breakdown ─────────────────────────
  // Source the values from the unified tax engine debug breakdowns so they
  // match the Taxes tab exactly. No local recomputation.
  const projection = taxMode === "forecast";
  const activeDebug = projection ? forecastDebug : actualDebug;
  const annualIncomeValue =
    activeDebug?.totalGrossIncome ??
    (projection ? (forecastDebug?.totalGrossIncome ?? 0) : summary.totalIncome);
  const investmentsValue = (() => {
    const entries = (investmentEntries || []).filter((e) => {
      if (projection) return new Date(e.entry_date).getFullYear() === currentYear;
      const d = new Date(e.entry_date);
      return d.getFullYear() === currentYear && d <= now;
    });
    return aggregateInvestmentTaxBuckets(entries).totalTaxableIncome;
  })();
  const businessProfitValue = activeDebug?.netBusinessProfit ?? summary.businessNetIncome;
  const w2TotalValue = activeDebug?.w2Income ?? summary.w2Income;
  const otherValueRaw = activeDebug
    ? activeDebug.otherIncome - investmentsValue
    : Math.max(0, summary.personalIncome - summary.w2Income - investmentsValue);
  const otherValue = Math.max(0, otherValueRaw);

  // ── Monthly income (actual + planned) ─────────────────────────────────────
  const monthlyIncome: MonthBreakdown[] = (() => {
    const months: MonthBreakdown[] = Array.from({ length: 12 }, (_, m) => ({
      month: m,
      actual: 0,
      planned: 0,
    }));
    const inYear = (iso: string) => new Date(iso).getFullYear() === currentYear;
    const monthOf = (iso: string) => new Date(iso).getMonth();
    const isPastOrCurrent = (iso: string) => new Date(iso).getTime() <= now.getTime();

    for (const t of transactions || []) {
      if (t.transaction_type !== "income") continue;
      if (isExcludedFromBusiness(t as any)) continue;
      if (!inYear(t.transaction_date)) continue;
      months[monthOf(t.transaction_date)].actual += Math.abs(t.amount);
    }
    for (const e of personalEntries || []) {
      if (!inYear(e.income_date)) continue;
      months[monthOf(e.income_date)].actual += Number(e.gross_amount || 0);
    }
    for (const e of investmentEntries || []) {
      if (!inYear(e.entry_date)) continue;
      const taxable = aggregateInvestmentTaxBuckets([e]).totalTaxableIncome;
      months[monthOf(e.entry_date)].actual += taxable;
    }
    // Single source-of-truth for planner monthly totals — matches the
    // Income Planner accordion's "active" filter and excludes converted,
    // matched/suggested, skipped, and past_due occurrences. Prevents
    // double counting against ledger entries summed into `actual` above.
    const plannerByMonth = getMonthlyPlannerBreakdown(projectedPaychecks, currentYear);
    for (let m = 0; m < 12; m++) {
      months[m].planned += plannerByMonth[m].plannedIncome;
    }
    return months;
  })();

  const ytdActualIncome = monthlyIncome.reduce((s, m) => s + m.actual, 0);

  const greeting =
    profileFirstName ||
    user?.user_metadata?.first_name ||
    (user?.email ? user.email.split("@")[0] : "back");

  // Single source of truth for the current-quarter recommendation. Same
  // helper drives QuarterlyTracker, the Tax Overview header card, and the
  // Dashboard near-deadline callout — so FinancialScore never disagrees.
  const manualSavingsRows = useMemo(
    () => taxSavings.map((s) => ({ savings_date: s.savings_date, amount: Number(s.amount) })),
    [taxSavings],
  );
  const quarterRecommendation = useMemo(
    () => buildQuarterRecommendation({
      annualTaxLiability,
      quarterMethod: rates?.quarterlyTrackerMethod ?? "even",
      incomeEntries: incomeEntries || [],
      personalEntries: personalEntries || [],
      transactions: transactions || [],
      investmentEntries: investmentEntries || [],
      projectedPaychecks,
      payments,
      manualSavings: manualSavingsRows,
      now,
    }),
    [annualTaxLiability, rates?.quarterlyTrackerMethod, incomeEntries, personalEntries, transactions, investmentEntries, projectedPaychecks, payments, manualSavingsRows, now],
  );
  const taxProgressPct = quarterRecommendation.coverageRatio * 100;
  const remainingTaxThisQuarter = Math.max(
    0,
    quarterRecommendation.quarterTarget - quarterRecommendation.progressAmount,
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header className="px-1 pb-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-medium text-foreground/90">Welcome back, {greeting}</h1>
          {hasLockedDashboardFeatures && (
            <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
              Premium
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground/80">Here's your money at a glance.</p>
      </header>

      {showProfileReviewBanner && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-card-foreground">Review your household income profile. We added income pathways so your dashboard matches your household.</p>
            <div className="flex gap-2">
              <Button asChild size="sm"><Link to="/onboarding" onClick={() => sessionStorage.setItem("paycheckmd-start-setup", "true")}>Start setup</Link></Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  localStorage.setItem("paycheckmd-household-income-profile-review-dismissed", "true");
                  if (rates?.id) void supabase.from("tax_settings").update({ onboarding_banner_dismissed: true } as any).eq("id", rates.id);
                  setShowProfileReviewBanner(false);
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </section>
      )}

      <div data-testid="dashboard-summary">
        <AnnualIncomeHero
          amount={annualIncomeValue}
          modeLabel={projection ? "Includes planned/future income" : "Income received so far this year"}
          subtext={methodLabel}
          toggle={<IncomeModeToggle alwaysShow={isW2Only} />}
        />
      </div>

      {isW2Only && forecastDebug && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-[11px] uppercase tracking-normal text-muted-foreground">Withholding Progress</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(forecastDebug.countedCreditsTotal)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-normal text-muted-foreground">Expected Refund / Amount Due</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {forecastDebug.remainingTaxDue > 0
                  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(forecastDebug.remainingTaxDue)
                  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.max(0, forecastDebug.countedCreditsTotal - forecastDebug.totalEstimatedTax))}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-normal text-muted-foreground">Extra Withholding Recommendation</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-primary">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(forecastDebug.recommendedSetAside)}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {forecastDebug.remainingTaxDue > 0
              ? `Based on your projected household income, deductions, taxes, and current withholding, you are projected to be short by ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(forecastDebug.remainingTaxDue)}. Add ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(forecastDebug.recommendedSetAside)} extra per paycheck to your W4, or save ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(forecastDebug.recommendedSetAside)} per paycheck manually.`
              : forecastDebug.countedCreditsTotal > forecastDebug.totalEstimatedTax
                ? `You are projected to have a refund of about ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(forecastDebug.countedCreditsTotal - forecastDebug.totalEstimatedTax)} if your income and withholding stay on track.`
                : "Your current withholding appears to be on track based on your projected household income, deductions, and taxes."}
          </p>
          {hasIncludedPriorNonW2Income && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Your current pathway is W2-only. Earlier income from other sources may still be included in your full-year tax projection if it was marked as included.
            </p>
          )}
        </section>
      )}

      {!isW2Only && (
        <DashboardQuarterlyPaymentCallout
          annualTaxLiability={annualTaxLiability}
          quarterMethod={rates?.quarterlyTrackerMethod ?? "even"}
          incomeEntries={incomeEntries || []}
          personalEntries={personalEntries || []}
          transactions={transactions || []}
          investmentEntries={investmentEntries || []}
          projectedPaychecks={projectedPaychecks}
          payments={payments}
          manualSavings={manualSavingsRows}
          fallback={() => (
            <QuarterlyTracker
              annualTaxLiability={annualTaxLiability}
              payments={payments}
              methodLabel={methodLabel}
              incomeEntries={incomeEntries || []}
              personalEntries={personalEntries || []}
              transactions={transactions || []}
              investmentEntries={investmentEntries || []}
              companies={companies}
              quarterMethod={rates?.quarterlyTrackerMethod ?? "even"}
              projectedPaychecks={projectedPaychecks}
              personalBucketRate={personalRate}
              businessBucketRate={businessRate}
              effectiveTaxRate={effectiveTaxRate}
              showCompanyBreakdown={false}
              showFooter={false}
              showTaxOverviewCta={false}
              showQuarterNavigation={false}
              linkDeadlineToTaxOverview
              manualSavings={manualSavingsRows}
            />
          )}
        />
      )}

      <IncomeBreakdownCards
        businessProfit={businessProfitValue}
        w2Total={w2TotalValue}
        investments={investmentsValue}
        other={otherValue}
      />

      <MonthlyIncomeCard
        months={monthlyIncome}
        currentMonth={currentMonth}
        ytdIncome={ytdActualIncome}
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
