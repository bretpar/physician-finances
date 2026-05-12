import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Sparkles, Compass, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter, getQuarterPayments, type QuarterLabel } from "@/lib/quarters";
import type { TaxPayment } from "@/hooks/useTaxPayments";
import { normalizeFilingType } from "@/lib/filingTypes";
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { aggregateInvestmentTaxBuckets, type InvestmentIncomeEntry } from "@/hooks/useInvestmentIncome";

/** Per-company current-quarter row split into paid (real withholdings) vs saved (reserves). */
export interface CompanyQuarterRow {
  key: string;
  label: string;
  paid: number;
  saved: number;
}

interface QuarterlyTrackerProps {
  annualTaxLiability: number;
  /** All tax payments — filtered internally by the displayed quarter + year. */
  payments: TaxPayment[];
  methodLabel?: string;
  /** Raw inputs — filtered by the displayed quarter window inside the tracker. */
  incomeEntries: any[];
  personalEntries: any[];
  transactions: any[];
  /** Investment income entries — `actual_tax_saved` counts as Saved (user reserve), never as Paid. */
  investmentEntries?: InvestmentIncomeEntry[];
  companies: { id: string; name: string; companyType?: string }[];
  /** "even" = annual / 4. "dynamic" = share-based on actual + planned income in this quarter. */
  quarterMethod?: "even" | "dynamic";
  /** Projected paychecks (date + grossAmount). Used only when quarterMethod="dynamic". */
  projectedPaychecks?: Array<{ date: string; grossAmount: number }>;
  /** Personal-bucket withholding target rate (percent, 0–100). Footer display. */
  personalBucketRate?: number;
  /** Business-bucket reserve target rate (percent, 0–100). Footer display. */
  businessBucketRate?: number;
  /** @deprecated kept for backward-compat; use personal/business rates instead. */
  effectiveTaxRate?: number;
  showCompanyBreakdown?: boolean;
  showFooter?: boolean;
  showTaxOverviewCta?: boolean;
  showQuarterNavigation?: boolean;
  linkDeadlineToTaxOverview?: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const clampPct = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

const Q_META: Record<1 | 2 | 3 | 4, { label: string; deadlineLabel: string }> = {
  1: { label: "Q1", deadlineLabel: "Apr 15" },
  2: { label: "Q2", deadlineLabel: "Jun 15" },
  3: { label: "Q3", deadlineLabel: "Sep 15" },
  4: { label: "Q4", deadlineLabel: "Jan 15" },
};

/** Build a quarter info object for an arbitrary (year, quarter) pair.
 *  Windows are standard *calendar* quarters:
 *    Q1: Jan 1 – Mar 31
 *    Q2: Apr 1 – Jun 30
 *    Q3: Jul 1 – Sep 30
 *    Q4: Oct 1 – Dec 31
 *  The `deadline` field still reflects the IRS estimated-tax due date for that
 *  quarter (used for display only), but all date filtering uses [start, end).
 */
function buildQuarter(year: number, quarter: 1 | 2 | 3 | 4) {
  const meta = Q_META[quarter];
  let start: Date;
  let end: Date; // exclusive
  let deadline: Date;
  if (quarter === 1) {
    start = new Date(year, 0, 1);
    end = new Date(year, 3, 1);
    deadline = new Date(year, 3, 15);
  } else if (quarter === 2) {
    start = new Date(year, 3, 1);
    end = new Date(year, 6, 1);
    deadline = new Date(year, 5, 15);
  } else if (quarter === 3) {
    start = new Date(year, 6, 1);
    end = new Date(year, 9, 1);
    deadline = new Date(year, 8, 15);
  } else {
    start = new Date(year, 9, 1);
    end = new Date(year + 1, 0, 1);
    deadline = new Date(year + 1, 0, 15);
  }
  return { quarter, year, label: meta.label, deadlineLabel: meta.deadlineLabel, deadline, start, end };
}

function stepQuarter(year: number, quarter: 1 | 2 | 3 | 4, dir: -1 | 1): { year: number; quarter: 1 | 2 | 3 | 4 } {
  let q = quarter + dir;
  let y = year;
  if (q < 1) { q = 4; y -= 1; }
  if (q > 4) { q = 1; y += 1; }
  return { year: y, quarter: q as 1 | 2 | 3 | 4 };
}

/** Calendar-quarter owning year/quarter for "today". */
function currentOwningYear(): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const quarter = (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
  return { year: now.getFullYear(), quarter };
}

export default function QuarterlyTracker({
  annualTaxLiability,
  payments,
  methodLabel,
  incomeEntries,
  personalEntries,
  transactions,
  investmentEntries = [],
  companies,
  quarterMethod = "even",
  projectedPaychecks = [],
  personalBucketRate,
  businessBucketRate,
  effectiveTaxRate,
  showCompanyBreakdown = true,
  showFooter = true,
  showTaxOverviewCta = false,
  showQuarterNavigation = true,
  linkDeadlineToTaxOverview = false,
}: QuarterlyTrackerProps) {
  const navigate = useNavigate();
  const initial = useMemo(() => currentOwningYear(), []);
  const [view, setView] = useState<{ year: number; quarter: 1 | 2 | 3 | 4 }>(initial);

  const q = useMemo(() => buildQuarter(view.year, view.quarter), [view]);
  const isCurrentQuarter = view.quarter === initial.quarter && view.year === initial.year;

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // ── Build per-company rows for the SELECTED quarter window ──────────────
  const companyRows: CompanyQuarterRow[] = useMemo(() => {
    const inQuarter = (iso: string) => {
      const d = new Date(iso);
      return d >= q.start && d < q.end;
    };
    const companyById = new Map(companies.map((c) => [c.id, c] as const));
    const liveTxById = new Map(
      (transactions || [])
        .filter((t: any) => t.transaction_type === "income" && !isExcludedFromBusiness(t))
        .map((t: any) => [t.id, t] as const),
    );

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

    for (const e of incomeEntries || []) {
      if (!e.linked_transaction_id) continue;
      const tx = liveTxById.get(e.linked_transaction_id);
      if (!tx) continue;
      // Business income is bucketed by the LEDGER ENTRY DATE (income_date),
      // not the projected/planner date. Once the quarter ends, only actual
      // entries within the window contribute.
      if (!inQuarter(e.income_date)) continue;
      const paid = getTotalFederalPaid(e);
      const saved =
        Number((tx as any).actual_withholding || 0) +
        Number(e.additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;
      const company = e.source_id ? companyById.get(e.source_id) : undefined;
      const filing = normalizeFilingType(e.income_type || company?.companyType);
      const hint = filingHint(filing);
      const name = company?.name || e.company || "Unassigned";
      const key = company?.id || `name:${name.toLowerCase().trim()}`;
      const label = hint ? `${name} (${hint})` : name;
      const row = ensure(key, label);
      row.paid += paid;
      row.saved += saved;
    }

    for (const e of personalEntries || []) {
      if (!inQuarter(e.income_date)) continue;
      // Federal-only canonical total via shared helper (handles legacy rows).
      const paid = getTotalFederalPaid(e);
      const saved = Number(e.additional_tax_reserve || 0);
      if (paid <= 0 && saved <= 0) continue;
      const name = (e.company || "Personal W-2").trim() || "Personal W-2";
      const key = `personal:${name.toLowerCase()}`;
      const row = ensure(key, `${name} (W-2)`);
      row.paid += paid;
      row.saved += saved;
    }

    return Array.from(buckets.entries()).map(([key, v]) => ({
      key, label: v.label, paid: v.paid, saved: v.saved,
    }));
  }, [incomeEntries, personalEntries, transactions, companies, q.start, q.end]);

  // ── Quarter math ──────────────────────────────────────────────────────────
  const quarterlyPayments = useMemo(
    () => getQuarterPayments(payments, q.label as QuarterLabel, view.year),
    [payments, q.label, view.year],
  );

  // Quarter target — either even (annual/4) or dynamic (share of annual liability
  // proportional to this quarter's actual + planned gross income vs full-year).
  const quarterTarget = useMemo(() => {
    if (quarterMethod !== "dynamic") {
      return Math.max(0, annualTaxLiability / 4);
    }
    const inWin = (iso: string) => {
      const d = new Date(iso);
      return d >= q.start && d < q.end;
    };
    // Actual income for the year (business + personal, by income_date)
    const yearStart = new Date(view.year, 0, 1);
    const yearEnd = new Date(view.year + 1, 0, 1);
    const inYear = (iso: string) => {
      const d = new Date(iso);
      return d >= yearStart && d < yearEnd;
    };
    let qIncome = 0;
    let yearIncome = 0;
    for (const t of transactions || []) {
      if (t.transaction_type !== "income") continue;
      const amt = Math.abs(Number(t.amount) || 0);
      if (inYear(t.transaction_date)) yearIncome += amt;
      if (inWin(t.transaction_date)) qIncome += amt;
    }
    for (const e of personalEntries || []) {
      const amt = Number(e.gross_amount || e.paycheck_amount || 0);
      if (inYear(e.income_date)) yearIncome += amt;
      if (inWin(e.income_date)) qIncome += amt;
    }
    // Add planned/projected paychecks (future occurrences)
    for (const p of projectedPaychecks || []) {
      const amt = Number(p.grossAmount || 0);
      if (inYear(p.date)) yearIncome += amt;
      if (inWin(p.date)) qIncome += amt;
    }
    // Investment income — count taxable amount toward both quarter and year buckets
    // so a large stock sale in this quarter raises that quarter's target share.
    for (const e of investmentEntries || []) {
      const amt = Number(e.taxable_amount || 0);
      if (inYear(e.entry_date)) yearIncome += amt;
      if (inWin(e.entry_date)) qIncome += amt;
    }
    if (yearIncome <= 0) return 0;
    const share = qIncome / yearIncome;
    return Math.max(0, annualTaxLiability * share);
  }, [quarterMethod, annualTaxLiability, transactions, personalEntries, projectedPaychecks, investmentEntries, q.start, q.end, view.year]);

  // Investment `actual_tax_saved` is a USER RESERVE (money set aside), not a
  // submitted tax payment — it counts as "Saved", never as "Paid".
  const investmentSavedThisQuarter = useMemo(() => {
    const inWin = (iso: string) => {
      const d = new Date(iso);
      return d >= q.start && d < q.end;
    };
    return (investmentEntries || [])
      .filter((e) => inWin(e.entry_date))
      .reduce((s, e) => s + Math.max(0, Number(e.actual_tax_saved ?? 0)), 0);
  }, [investmentEntries, q.start, q.end]);

  const paidFromCompanies = companyRows.reduce((s, c) => s + c.paid, 0);
  const paidThisQuarter = paidFromCompanies + quarterlyPayments;
  const rawSavedThisQuarter =
    companyRows.reduce((s, c) => s + c.saved, 0) + investmentSavedThisQuarter;
  const savedThisQuarter = Math.max(0, rawSavedThisQuarter - quarterlyPayments);
  const progressAmount = paidThisQuarter + savedThisQuarter;
  const remainingThisQuarter = Math.max(0, quarterTarget - progressAmount);

  // ── Pace math (vs today's expected, not full target) ──────────────────────
  // Today marker depends ONLY on the current date and quarter window — not on
  // tax/payment/savings data. Normalize to local noon to avoid TZ off-by-one.
  const { quarterProgress, isFutureQuarter, isPastQuarter } = useMemo(() => {
    const raw = new Date();
    const today = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 12, 0, 0);
    const start = new Date(q.start.getFullYear(), q.start.getMonth(), q.start.getDate(), 12, 0, 0);
    const end = new Date(q.end.getFullYear(), q.end.getMonth(), q.end.getDate(), 12, 0, 0);
    const totalMs = Math.max(1, end.getTime() - start.getTime());
    const elapsedMs = today.getTime() - start.getTime();
    const progress = Math.max(0, Math.min(1, elapsedMs / totalMs));
    return {
      quarterProgress: progress,
      isFutureQuarter: today < start,
      isPastQuarter: today >= end,
    };
  }, [q.start, q.end]);
  const now = new Date();
  const expectedByNow = quarterTarget * quarterProgress;
  const paceDiff = progressAmount - expectedByNow;
  const tolerance = Math.max(expectedByNow * 0.1, 250);

  type Tone = "ok" | "ahead" | "soft" | "behind";
  let tone: Tone;
  let message: string;
  if (quarterTarget === 0) {
    tone = "ok";
    message = "No estimated tax target this quarter.";
  } else if (isFutureQuarter) {
    tone = "soft";
    message = `${q.label} hasn't started yet — nothing due today.`;
  } else if (isPastQuarter) {
    tone = progressAmount + tolerance >= quarterTarget ? "ok" : "behind";
    message = progressAmount + tolerance >= quarterTarget
      ? `${q.label} complete.`
      : `${q.label} ended ${fmt(Math.max(0, quarterTarget - progressAmount))} short.`;
  } else if (quarterProgress < 0.1) {
    tone = "soft";
    message = expectedByNow > 0 && progressAmount < expectedByNow - tolerance
      ? `Early in the quarter — aim for ${fmt(expectedByNow)} by today.`
      : "Early in the quarter — pacing toward the next deadline.";
  } else if (paceDiff >= tolerance) {
    tone = "ahead";
    message = `Ahead of pace by ${fmt(paceDiff)}`;
  } else if (Math.abs(paceDiff) < tolerance) {
    tone = "ok";
    message = "On pace for this point in the quarter";
  } else if (paceDiff > -tolerance * 2) {
    tone = "soft";
    message = `A little behind — set aside ${fmt(-paceDiff)} more`;
  } else {
    tone = "behind";
    message = `To stay on pace, save ${fmt(-paceDiff)} more`;
  }

  const toneStyles = {
    ok:     { ring: "border-border",                          text: "text-foreground",       accent: "text-primary",  Icon: CheckCircle2 },
    ahead:  { ring: "border-success/40 bg-success/[0.04]",    text: "text-success",          accent: "text-success",  Icon: Sparkles },
    soft:   { ring: "border-border",                          text: "text-muted-foreground", accent: "text-primary",  Icon: Compass },
    behind: { ring: "border-warning/40 bg-warning/[0.04]",    text: "text-warning",          accent: "text-warning",  Icon: Compass },
  }[tone];
  const { Icon } = toneStyles;

  // Bar percentages — capped at quarter target.
  const paidPct = clampPct(quarterTarget > 0 ? (paidThisQuarter / quarterTarget) * 100 : 0);
  const savedPct = Math.min(100 - paidPct, clampPct(quarterTarget > 0 ? (savedThisQuarter / quarterTarget) * 100 : 0));
  const expectedPct = clampPct(quarterProgress * 100);
  const animPaidPct = clampPct(useCountUp(paidPct, 1100));
  const animSavedPct = Math.min(100 - animPaidPct, clampPct(useCountUp(savedPct, 1100)));
  // Today marker renders immediately — no animation, no waiting on data.
  const showTodayMarker = !isFutureQuarter && !isPastQuarter && expectedPct > 0 && expectedPct < 100;

  // Prorate the estimated-payment offset across companies by their saved share.
  const offset = Math.min(rawSavedThisQuarter, quarterlyPayments);
  const sortedCompanies = [...companyRows].sort((a, b) => (b.paid + b.saved) - (a.paid + a.saved));
  const adjustedCompanyRows = sortedCompanies.map((c) => {
    const share = rawSavedThisQuarter > 0 ? c.saved / rawSavedThisQuarter : 0;
    const adjSaved = Math.max(0, c.saved - offset * share);
    return { key: c.key, label: c.label, paid: c.paid, saved: adjSaved };
  });
  const rows = [
    ...adjustedCompanyRows,
    {
      key: "__quarterly_payments__",
      label: `${q.label} estimated payments`,
      paid: quarterlyPayments,
      saved: 0,
    },
  ];
  const hasAny = rows.some((r) => r.paid > 0 || r.saved > 0);

  const goPrev = () => setView(stepQuarter(view.year, view.quarter, -1));
  const goNext = () => setView(stepQuarter(view.year, view.quarter, 1));

  return (
    <Card className={cn("border-2 transition-colors relative", toneStyles.ring)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <Icon className={cn("h-5 w-5 shrink-0", toneStyles.accent)} />
            <span className="truncate">{q.label} Tax Progress</span>
          </CardTitle>
          {linkDeadlineToTaxOverview ? (
            <button
              type="button"
              onClick={() => navigate("/taxes#quarterly-estimator")}
              className="shrink-0 text-xs text-muted-foreground underline underline-offset-4 transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground active:translate-y-0 active:scale-95"
            >
              Due {q.deadlineLabel}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground shrink-0">Due {q.deadlineLabel}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-4", showQuarterNavigation ? "pb-10" : "pb-4")}>
        {/* Primary numbers */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium break-words">
              Paid + Saved QTD
            </p>
            <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-foreground whitespace-nowrap">
              {fmt(progressAmount)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium break-words">
              Suggested by today
            </p>
            <p className={cn("mt-1 text-2xl sm:text-3xl font-bold tabular-nums whitespace-nowrap", toneStyles.accent)}>
              {fmt(expectedByNow)}
            </p>
          </div>
        </div>

        {/* Pace bar with today's marker */}
        <div className="space-y-1.5">
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary flex">
            <div
              className="h-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${animPaidPct}%` }}
            />
            <div
              className="h-full bg-primary/40 transition-[width] duration-700 ease-out"
              style={{ width: `${animSavedPct}%` }}
            />
            {showTodayMarker && (
              <div
                className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-foreground/70 rounded-sm"
                style={{ left: `${expectedPct}%` }}
                aria-label="Today's expected pace"
                title={`Today's pace: ${fmt(expectedByNow)}`}
              />
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" />Paid</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/40" />Saved</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-0.5 bg-foreground/70 rounded-sm" />Today</span>
          </div>
        </div>

        {/* Compact status callout */}
        <div className={cn("flex items-center gap-2 text-sm", toneStyles.text)}>
          <Icon className={cn("h-4 w-4 shrink-0", toneStyles.accent)} />
          <span className="truncate">{message}</span>
        </div>

        {/* Secondary line */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Quarter target: <span className="tabular-nums text-foreground/70">{fmt(quarterTarget)}</span></span>
          {remainingThisQuarter > 0 && (
            <span>Still to fund: <span className="tabular-nums">{fmt(remainingThisQuarter)}</span></span>
          )}
        </div>

        {showTaxOverviewCta && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => navigate("/taxes#quarterly-estimator")}
          >
            View Tax Overview
          </Button>
        )}

        {/* Per-company breakdown */}
        {showCompanyBreakdown && <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
          <div className="overflow-hidden rounded-lg border bg-card/50">
            <CollapsibleTrigger className="w-full min-w-0 px-3 py-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] items-start sm:items-center gap-1 sm:gap-x-3 text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-accent/30 transition-colors rounded-lg">
              <span className="flex min-w-0 items-center gap-1.5 text-left">
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", breakdownOpen && "rotate-180")} />
                <span className="min-w-0 break-words">This quarter by company</span>
              </span>
              <span className="hidden text-right w-20 sm:block">Paid</span>
              <span className="hidden text-center w-3 sm:block">·</span>
              <span className="hidden text-right w-20 sm:block">Saved</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border border-t">
                {!hasAny ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    Nothing tracked yet for {q.label} {view.year}.
                  </div>
                ) : (
                  rows.map((r) => {
                    const empty = r.paid === 0 && r.saved === 0;
                    return (
                      <div
                        key={r.key}
                        className="px-3 py-2.5 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] items-start sm:items-center gap-2 sm:gap-x-3 text-sm"
                      >
                        <span className={cn("min-w-0 break-words leading-snug", empty && "text-muted-foreground")}>{r.label}</span>
                        <div className="grid grid-cols-2 gap-2 sm:contents">
                          <span className={cn("rounded-md bg-muted/40 px-2 py-1 text-left tabular-nums sm:w-20 sm:bg-transparent sm:p-0 sm:text-right", r.paid === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">Paid</span>
                            {fmt(r.paid)}
                          </span>
                          <span className="hidden text-muted-foreground text-center w-3 sm:block">·</span>
                          <span className={cn("rounded-md bg-muted/40 px-2 py-1 text-left tabular-nums sm:w-20 sm:bg-transparent sm:p-0 sm:text-right", r.saved === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">Saved</span>
                            {fmt(r.saved)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>}

        {/* Single footer line — quarterly target context + bucket-aware rates */}
        {showFooter && <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
          Quarterly target based on Current + Planned income
          {(typeof personalBucketRate === "number" && Number.isFinite(personalBucketRate)) ||
          (typeof businessBucketRate === "number" && Number.isFinite(businessBucketRate)) ? (
            <>
              {" "}· Personal:{" "}
              <span className="text-foreground/80 font-medium tabular-nums">
                {(personalBucketRate ?? 0).toFixed(1)}%
              </span>{" "}
              · Business:{" "}
              <span className="text-foreground/80 font-medium tabular-nums">
                {(businessBucketRate ?? 0).toFixed(1)}%
              </span>
            </>
          ) : typeof effectiveTaxRate === "number" && Number.isFinite(effectiveTaxRate) ? (
            <> · Effective Tax Rate: <span className="text-foreground/80 font-medium tabular-nums">{effectiveTaxRate.toFixed(1)}%</span></>
          ) : null}
        </p>}

        {/* Quarter navigation affordance */}
        {showQuarterNavigation && <div className="absolute bottom-2 right-2 flex items-center gap-0.5 text-muted-foreground">
          <button
            type="button"
            onClick={goPrev}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent/50 hover:text-foreground transition-colors"
            aria-label="Previous quarter"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {!isCurrentQuarter && (
            <span className="text-[10px] tabular-nums px-1">{q.label} {view.year}</span>
          )}
          <button
            type="button"
            onClick={goNext}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent/50 hover:text-foreground transition-colors"
            aria-label="Next quarter"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>}
      </CardContent>
    </Card>
  );
}
