import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Sparkles, Compass, ChevronDown, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { type QuarterLabel, getCurrentQuarter } from "@/lib/quarters";
import type { TaxPayment } from "@/hooks/useTaxPayments";
import { type InvestmentIncomeEntry } from "@/hooks/useInvestmentIncome";
import { buildQuarterRecommendation, getActivePaymentTarget } from "@/lib/quarterRecommendation";

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
  breakdownTitle?: string;
  /** When true, render the "Recommended quarterly payment" header card with the
   *  full quarter-target / paid / saved / remaining breakdown. Tax Overview. */
  showRecommendedPayment?: boolean;
  /** Optional CTA shown inside the recommended-payment card. */
  onLogPayment?: () => void;
  /** Manual `tax_savings` rows; counted as Saved (not Paid) by the canonical
   *  recommendation helper. */
  manualSavings?: Array<{ savings_date?: string; amount: number | string }>;
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
 *  Windows are IRS estimated-tax periods:
 *    Q1: Jan 1 – Mar 31  (deadline Apr 15)
 *    Q2: Apr 1 – May 31  (deadline Jun 15)
 *    Q3: Jun 1 – Aug 31  (deadline Sep 15)
 *    Q4: Sep 1 – Dec 31  (deadline Jan 15 next year)
 *  All date filtering uses [start, end).
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
    end = new Date(year, 5, 1);
    deadline = new Date(year, 5, 15);
  } else if (quarter === 3) {
    start = new Date(year, 5, 1);
    end = new Date(year, 8, 1);
    deadline = new Date(year, 8, 15);
  } else {
    start = new Date(year, 8, 1);
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

/** Owning year/quarter for "today" using `getActivePaymentTarget` so the
 *  Tax Overview tracker stays aligned with the Dashboard's Q2 Payment Due
 *  card during the 20-day-before / 7-day-after due window. On e.g. Jun 9
 *  this returns Q2 (deadline Jun 15), not the calendar Q3 income period.
 *  After Jun 22 it falls back to the current income period (Q3). */
function currentOwningYear(): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const now = new Date();
  const target = getActivePaymentTarget(now);
  return { year: target.year, quarter: target.quarter as 1 | 2 | 3 | 4 };
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
  breakdownTitle = "This quarter by company",
  showRecommendedPayment = false,
  onLogPayment,
  manualSavings = [],
}: QuarterlyTrackerProps) {
  const navigate = useNavigate();
  const initial = useMemo(() => currentOwningYear(), []);
  const [view, setView] = useState<{ year: number; quarter: 1 | 2 | 3 | 4 }>(initial);

  const q = useMemo(() => buildQuarter(view.year, view.quarter), [view]);
  const isCurrentQuarter = view.quarter === initial.quarter && view.year === initial.year;

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ── Canonical recommendation (single source of truth) ─────────────────
  // Quarter target, paid, saved, progress, recommended payment, and source
  // rows all come from `buildQuarterRecommendation` so this component
  // cannot drift from Dashboard / Tax Overview.
  const recommendation = useMemo(
    () =>
      buildQuarterRecommendation({
        annualTaxLiability,
        year: view.year,
        quarter: view.quarter,
        quarterMethod,
        incomeEntries,
        personalEntries,
        transactions,
        investmentEntries,
        projectedPaychecks,
        payments,
        manualSavings,
      }),
    [annualTaxLiability, view.year, view.quarter, quarterMethod, incomeEntries, personalEntries, transactions, investmentEntries, projectedPaychecks, payments, manualSavings],
  );

  const quarterTarget = recommendation.quarterTarget;
  const paidThisQuarter = recommendation.paidThisQuarter;
  const savedThisQuarter = recommendation.savedThisQuarter;
  const progressAmount = recommendation.progressAmount;
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

  // Source rows come directly from the canonical helper (single source of
  // truth). Sort by combined paid+saved so the largest contributors lead.
  const rows = [...recommendation.sourceRows].sort(
    (a, b) => (b.paid + b.saved) - (a.paid + a.saved),
  );
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
        {showRecommendedPayment && (
          <div className="rounded-lg border-2 border-primary/30 bg-primary/[0.04] p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                  Recommended quarterly payment
                </p>
                <p className="mt-1 text-3xl sm:text-4xl font-bold tabular-nums text-primary whitespace-nowrap">
                  {fmt(recommendation.recommendedPaymentToMake)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Amount to submit for {recommendation.quarterLabel} after W-2 withholding, other actual withholding, and estimated payments already made. Saved reserves are not subtracted.
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Due date</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{recommendation.deadlineLabel}, {recommendation.taxYear}</p>
              </div>
            </div>
            <div className={cn("grid gap-3 pt-1 border-t border-primary/15", recommendation.otherWithheldThisQuarter > 0 ? "grid-cols-2 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-5") }>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Quarter target</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{fmt(recommendation.quarterTarget)}</p>
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Federal W-2 withholding paid</p>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="What's included in Federal W-2 withholding paid" className="text-muted-foreground hover:text-foreground">
                          <Info className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        Includes federal income tax withheld from W-2 paychecks. Does not include W-2 Social Security or Medicare payroll taxes. Self-employment tax for 1099 income is included in the quarterly tax target.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{fmt(recommendation.w2WithheldThisQuarter)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimated payments made</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{fmt(recommendation.estimatedPaymentsMade)}</p>
              </div>
              {recommendation.otherWithheldThisQuarter > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Other withholding paid</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{fmt(recommendation.otherWithheldThisQuarter)}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Saved/reserved but not paid</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{fmt(recommendation.savedThisQuarter)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recommended payment remaining</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{fmt(recommendation.stillNeedToSave)}</p>
              </div>
            </div>
          </div>
        )}
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
              <span className="min-w-0 break-words">{breakdownTitle}</span>
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
