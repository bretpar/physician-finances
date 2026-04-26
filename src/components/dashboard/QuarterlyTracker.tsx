import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Sparkles, Compass, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import type { TaxPayment } from "@/hooks/useTaxPayments";
import { useQuarterlyEstimator, type CompanyQuarterRow } from "@/hooks/useQuarterlyEstimator";

export type { CompanyQuarterRow };

interface QuarterlyTrackerProps {
  annualTaxLiability: number;
  /** All tax payments — filtered internally by the displayed quarter + year. */
  payments: TaxPayment[];
  methodLabel?: string;
  /** Raw inputs — filtered by the displayed quarter window inside the tracker. */
  incomeEntries: any[];
  personalEntries: any[];
  transactions: any[];
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
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function QuarterlyTracker({
  annualTaxLiability,
  payments,
  methodLabel,
  incomeEntries,
  personalEntries,
  transactions,
  companies,
  quarterMethod = "even",
  projectedPaychecks = [],
  personalBucketRate,
  businessBucketRate,
  effectiveTaxRate,
}: QuarterlyTrackerProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const {
    view,
    q,
    isCurrentQuarter,
    quarterlyPayments,
    quarterTarget,
    savedThisQuarter,
    progressAmount,
    remainingThisQuarter,
    expectedByNow,
    tone,
    message,
    paidPct,
    savedPct,
    expectedPct,
    rows,
    hasAny,
    goPrev,
    goNext,
  } = useQuarterlyEstimator({
    annualTaxLiability,
    payments,
    incomeEntries,
    personalEntries,
    transactions,
    companies,
    quarterMethod,
    projectedPaychecks,
  });

  const toneStyles = {
    ok:     { ring: "border-border",                          text: "text-foreground",       accent: "text-primary",  Icon: CheckCircle2 },
    ahead:  { ring: "border-success/40 bg-success/[0.04]",    text: "text-success",          accent: "text-success",  Icon: Sparkles },
    soft:   { ring: "border-border",                          text: "text-muted-foreground", accent: "text-primary",  Icon: Compass },
    behind: { ring: "border-warning/40 bg-warning/[0.04]",    text: "text-warning",          accent: "text-warning",  Icon: Compass },
  }[tone];
  const { Icon } = toneStyles;

  const animPaidPct = useCountUp(paidPct, 1100);
  const animSavedPct = useCountUp(savedPct, 1100);
  const animExpectedPct = useCountUp(expectedPct, 1100);

  return (
    <Card className={cn("border-2 transition-colors relative", toneStyles.ring)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <Icon className={cn("h-5 w-5 shrink-0", toneStyles.accent)} />
            <span className="truncate">{q.label} Tax Progress</span>
          </CardTitle>
          <span className="text-xs text-muted-foreground shrink-0">due {q.deadlineLabel}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pb-10">
        {/* Primary numbers — stack on mobile, 2-up on sm+ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium">
              Paid + Saved QTD
            </p>
            <p className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground mt-0.5 whitespace-nowrap">
              {fmt(progressAmount)}
            </p>
          </div>
          <div>
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium">
              Suggested by today
            </p>
            <p className={cn("text-2xl sm:text-3xl font-bold tabular-nums mt-0.5 whitespace-nowrap", toneStyles.accent)}>
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
            {expectedPct > 0 && expectedPct < 100 && (
              <div
                className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-foreground/70 rounded-sm transition-[left] duration-700 ease-out"
                style={{ left: `${animExpectedPct}%` }}
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

        {/* Per-company breakdown */}
        <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
          <div className="rounded-lg border bg-card/50">
            <CollapsibleTrigger className="w-full px-3 py-2 flex flex-col gap-2 text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-accent/30 transition-colors rounded-lg sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-x-4">
              <span className="flex min-w-0 items-center gap-1.5 text-left">
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", breakdownOpen && "rotate-180")} />
                <span className="break-words">This quarter by company</span>
              </span>
              <span className="grid w-full grid-cols-2 gap-2 text-left sm:contents">
                <span className="text-left sm:text-right sm:w-20">Paid</span>
                <span className="text-left sm:text-right sm:w-20">Saved</span>
              </span>
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
                      <div key={r.key} className="px-3 py-3 text-sm sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-x-4">
                        <span className={cn("block min-w-0 break-words leading-snug", empty && "text-muted-foreground")}>{r.label}</span>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:contents">
                          <span className={cn("min-w-0 rounded-md bg-muted/40 px-2 py-1 tabular-nums text-left sm:bg-transparent sm:p-0 sm:text-right sm:w-20", r.paid === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">Paid</span>
                            <span className="block truncate">{fmt(r.paid)}</span>
                          </span>
                          <span className={cn("min-w-0 rounded-md bg-muted/40 px-2 py-1 tabular-nums text-left sm:bg-transparent sm:p-0 sm:text-right sm:w-20", r.saved === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">Saved</span>
                            <span className="block truncate">{fmt(r.saved)}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* Single footer line — quarterly target context + bucket-aware rates */}
        <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
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
        </p>

        {/* Quarter navigation affordance */}
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 text-muted-foreground">
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
        </div>
      </CardContent>
    </Card>
  );
}
