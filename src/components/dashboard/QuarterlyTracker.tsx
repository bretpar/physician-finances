import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Sparkles, Compass, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter, getQuarterPayments, type QuarterLabel } from "@/lib/quarters";
import type { TaxPayment } from "@/hooks/useTaxPayments";

/** Per-company current-quarter row split into paid (real withholdings) vs saved (reserves). */
export interface CompanyQuarterRow {
  key: string;
  label: string;
  paid: number;
  saved: number;
}

interface QuarterlyTrackerProps {
  annualTaxLiability: number;
  companies: CompanyQuarterRow[];
  /** All tax payments — filtered internally by the displayed quarter + year. */
  payments: TaxPayment[];
  methodLabel?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const Q_META: Record<1 | 2 | 3 | 4, { label: string; deadlineLabel: string }> = {
  1: { label: "Q1", deadlineLabel: "Apr 15" },
  2: { label: "Q2", deadlineLabel: "Jun 15" },
  3: { label: "Q3", deadlineLabel: "Sep 15" },
  4: { label: "Q4", deadlineLabel: "Jan 15" },
};

/** Build a quarter info object for an arbitrary (year, quarter) pair. */
function buildQuarter(year: number, quarter: 1 | 2 | 3 | 4) {
  const meta = Q_META[quarter];
  let deadline: Date;
  let start: Date;
  let end: Date;
  if (quarter === 1) {
    deadline = new Date(year, 3, 15);
    start = new Date(year - 1, 0, 16);
    end = deadline;
  } else if (quarter === 2) {
    deadline = new Date(year, 5, 15);
    start = new Date(year, 3, 16);
    end = deadline;
  } else if (quarter === 3) {
    deadline = new Date(year, 8, 15);
    start = new Date(year, 5, 16);
    end = deadline;
  } else {
    // Q4 deadline is Jan 15 of *next* year; window starts Sep 16 of `year`
    deadline = new Date(year + 1, 0, 15);
    start = new Date(year, 8, 16);
    end = deadline;
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

export default function QuarterlyTracker({
  annualTaxLiability,
  companies,
  payments,
  methodLabel,
}: QuarterlyTrackerProps) {
  const current = getCurrentQuarter();
  const [view, setView] = useState<{ year: number; quarter: 1 | 2 | 3 | 4 }>({
    year: current.deadline.getFullYear() - (current.quarter === 4 ? 0 : 0),
    // Q4 deadline is in next year; we want the "owning" year. Use start year.
    quarter: current.quarter,
  });
  // Recompute owning year from current quarter: window-start year.
  // For Q4, current.deadline is Jan 15 next year, window starts Sep 16 prior — initial view should reflect that.
  const initialOwningYear = useMemo(() => {
    if (current.quarter === 4) return current.deadline.getFullYear() - 1;
    return current.deadline.getFullYear();
  }, [current]);
  // If state still has stale year from initial render, normalize once via memo:
  const activeYear = view.year === current.deadline.getFullYear() && current.quarter === 4 ? initialOwningYear : view.year;

  const q = buildQuarter(activeYear, view.quarter);
  const isCurrentQuarter = q.quarter === current.quarter && q.deadline.getTime() === current.deadline.getTime();

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // ── Quarter math ──────────────────────────────────────────────────────────
  // Estimated tax payments for THIS displayed quarter+year.
  const quarterlyPayments = useMemo(
    () => getQuarterPayments(payments, q.label as QuarterLabel, activeYear),
    [payments, q.label, activeYear],
  );
  const quarterTarget = Math.max(0, annualTaxLiability / 4);
  const paidFromCompanies = companies.reduce((s, c) => s + c.paid, 0);
  const paidThisQuarter = paidFromCompanies + quarterlyPayments;
  const savedThisQuarter = companies.reduce((s, c) => s + c.saved, 0);
  const progressAmount = paidThisQuarter + savedThisQuarter;
  const remainingThisQuarter = Math.max(0, quarterTarget - progressAmount);

  // ── Pace math (vs today's expected, not full target) ──────────────────────
  const now = new Date();
  const totalDays = Math.max(1, (q.end.getTime() - q.start.getTime()) / 86400000);
  const elapsedDays = Math.max(0, (now.getTime() - q.start.getTime()) / 86400000);
  const quarterProgress = Math.max(0, Math.min(1, elapsedDays / totalDays));
  const expectedByNow = quarterTarget * quarterProgress;
  const paceDiff = progressAmount - expectedByNow;
  const tolerance = Math.max(expectedByNow * 0.1, 250);

  type Tone = "ok" | "ahead" | "soft" | "behind";
  let tone: Tone;
  let message: string;
  if (quarterTarget === 0) {
    tone = "ok";
    message = "No estimated tax target this quarter.";
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
  const paidPct = quarterTarget > 0 ? Math.min(100, (paidThisQuarter / quarterTarget) * 100) : 0;
  const savedPct = Math.max(0, Math.min(100 - paidPct, quarterTarget > 0 ? (savedThisQuarter / quarterTarget) * 100 : 0));
  const expectedPct = quarterTarget > 0 ? Math.min(100, quarterProgress * 100) : 0;
  const animPaidPct = useCountUp(paidPct, 1100);
  const animSavedPct = useCountUp(savedPct, 1100);
  const animExpectedPct = useCountUp(expectedPct, 1100);

  // Breakdown rows
  const sortedCompanies = [...companies].sort((a, b) => (b.paid + b.saved) - (a.paid + a.saved));
  const rows = [
    ...sortedCompanies.map((c) => ({ key: c.key, label: c.label, paid: c.paid, saved: c.saved })),
    {
      key: "__quarterly_payments__",
      label: `${q.label} estimated payments`,
      paid: quarterlyPayments,
      saved: 0,
    },
  ];
  const hasAny = rows.some((r) => r.paid > 0 || r.saved > 0);

  const goPrev = () => {
    const next = stepQuarter(activeYear, view.quarter, -1);
    setView(next);
  };
  const goNext = () => {
    const next = stepQuarter(activeYear, view.quarter, 1);
    setView(next);
  };

  return (
    <Card className={cn("border-2 transition-colors relative", toneStyles.ring)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2 min-w-0">
            <Icon className={cn("h-5 w-5 shrink-0", toneStyles.accent)} />
            <span className="truncate">Quarterly Tax Progress ({q.label})</span>
          </CardTitle>
          <span className="text-xs text-muted-foreground shrink-0">due {q.deadlineLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          Pace toward the {q.deadlineLabel} tax deadline
          {methodLabel ? ` · ${methodLabel}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pb-10">
        {/* Primary numbers — 2-up */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid + Saved QTD</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{fmt(progressAmount)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Suggested by today</p>
            <p className={cn("text-lg font-semibold tabular-nums", toneStyles.accent)}>{fmt(expectedByNow)}</p>
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
            <CollapsibleTrigger className="w-full px-3 py-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-accent/30 transition-colors rounded-lg">
              <span className="flex items-center gap-1.5 text-left">
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", breakdownOpen && "rotate-180")} />
                This quarter by company
              </span>
              <span className="text-right w-16">Paid</span>
              <span className="text-center w-3">·</span>
              <span className="text-right w-16">Saved</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border border-t">
                {!hasAny ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    Nothing tracked yet for {q.label}.
                  </div>
                ) : (
                  rows.map((r) => {
                    const empty = r.paid === 0 && r.saved === 0;
                    return (
                      <div
                        key={r.key}
                        className="px-3 py-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-sm"
                      >
                        <span className={cn("truncate", empty && "text-muted-foreground")}>{r.label}</span>
                        <span className={cn("tabular-nums text-right w-16", r.paid === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                          {fmt(r.paid)}
                        </span>
                        <span className="text-muted-foreground text-center w-3">·</span>
                        <span className={cn("tabular-nums text-right w-16", r.saved === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                          {fmt(r.saved)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <p className="text-[11px] text-muted-foreground italic">
          Saved amounts are not yet submitted tax payments.
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
            <span className="text-[10px] tabular-nums px-1">{q.label} {activeYear}</span>
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
