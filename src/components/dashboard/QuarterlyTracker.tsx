import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Sparkles, Compass, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter } from "@/lib/quarters";

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
  quarterlyPayments: number;
  methodLabel?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Start date of the quarter that owns this deadline. Q1→Jan 16 prev, Q2→Apr 16, Q3→Jun 16, Q4→Sep 16. */
function getQuarterWindow(deadline: Date, q: 1 | 2 | 3 | 4): { start: Date; end: Date } {
  const end = deadline;
  const year = deadline.getFullYear();
  let start: Date;
  if (q === 1) start = new Date(year - 1, 0, 16); // Jan 16 prior year
  else if (q === 2) start = new Date(year, 3, 16); // Apr 16
  else if (q === 3) start = new Date(year, 5, 16); // Jun 16
  else start = new Date(year - 1, 8, 16); // Sep 16 prior year (Q4 deadline is Jan 15 next year)
  return { start, end };
}

export default function QuarterlyTracker({
  annualTaxLiability,
  companies,
  quarterlyPayments,
  methodLabel,
}: QuarterlyTrackerProps) {
  const q = getCurrentQuarter();
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // ── Quarter math ──────────────────────────────────────────────────────────
  const quarterTarget = Math.max(0, annualTaxLiability / 4);
  const paidFromCompanies = companies.reduce((s, c) => s + c.paid, 0);
  const paidThisQuarter = paidFromCompanies + quarterlyPayments;
  const savedThisQuarter = companies.reduce((s, c) => s + c.saved, 0);
  const progressAmount = paidThisQuarter + savedThisQuarter;
  const remainingThisQuarter = Math.max(0, quarterTarget - progressAmount);

  // ── Pace math (vs today's expected, not full target) ──────────────────────
  const now = new Date();
  const { start, end } = getQuarterWindow(q.deadline, q.quarter);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  const elapsedDays = Math.max(0, (now.getTime() - start.getTime()) / 86400000);
  const quarterProgress = Math.max(0, Math.min(1, elapsedDays / totalDays));
  const expectedByNow = quarterTarget * quarterProgress;
  const paceDiff = progressAmount - expectedByNow; // + ahead, − behind
  const tolerance = Math.max(expectedByNow * 0.1, 250);

  // Tone & message: pace-based, with early-quarter softening.
  type Tone = "ok" | "ahead" | "soft" | "behind";
  let tone: Tone;
  let message: string;
  if (quarterTarget === 0) {
    tone = "ok";
    message = "No estimated tax target this quarter — you're all set.";
  } else if (quarterProgress < 0.1) {
    tone = "soft";
    message = expectedByNow > 0 && progressAmount < expectedByNow - tolerance
      ? `It's still early this quarter — aim for about ${fmt(expectedByNow)} by today to stay on pace.`
      : "It's still early this quarter. Here's your suggested pace toward the next deadline.";
  } else if (paceDiff >= tolerance) {
    tone = "ahead";
    message = `You're ahead of pace by ${fmt(paceDiff)}. Nice work.`;
  } else if (Math.abs(paceDiff) < tolerance) {
    tone = "ok";
    message = "You're on pace for this point in the quarter.";
  } else if (paceDiff > -tolerance * 2) {
    tone = "soft";
    message = `You're a little behind pace — consider setting aside ${fmt(-paceDiff)} more.`;
  } else {
    tone = "behind";
    message = `To stay on pace by today, aim to save ${fmt(-paceDiff)} more.`;
  }

  const toneStyles = {
    ok:     { ring: "border-border",                          text: "text-foreground",   accent: "text-primary",     Icon: CheckCircle2 },
    ahead:  { ring: "border-success/40 bg-success/[0.04]",    text: "text-success",      accent: "text-success",     Icon: Sparkles },
    soft:   { ring: "border-border",                          text: "text-muted-foreground", accent: "text-primary", Icon: Compass },
    behind: { ring: "border-warning/40 bg-warning/[0.04]",    text: "text-warning",      accent: "text-warning",     Icon: Compass },
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
  const sortedCompanies = [...companies].sort(
    (a, b) => (b.paid + b.saved) - (a.paid + a.saved),
  );
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

  return (
    <Card className={cn("border-2 transition-colors", toneStyles.ring)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Icon className={cn("h-5 w-5", toneStyles.accent)} />
            Quarterly Tax Progress ({q.label})
          </CardTitle>
          <span className="text-xs text-muted-foreground">due {q.deadlineLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Your pace toward the {q.deadlineLabel} estimated tax deadline
          {methodLabel ? ` · ${methodLabel}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary numbers */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Saved + paid so far</p>
            <p className="font-semibold tabular-nums text-foreground">{fmt(progressAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Suggested by today</p>
            <p className={cn("font-semibold tabular-nums", toneStyles.accent)}>{fmt(expectedByNow)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Quarter target</p>
            <p className="font-semibold tabular-nums text-muted-foreground">{fmt(quarterTarget)}</p>
          </div>
        </div>

        {/* Pace bar with today's marker */}
        <div className="space-y-2">
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary flex">
            <div
              className="h-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${animPaidPct}%` }}
            />
            <div
              className="h-full bg-primary/40 transition-[width] duration-700 ease-out"
              style={{ width: `${animSavedPct}%` }}
            />
            {/* Today's pace marker */}
            {expectedPct > 0 && expectedPct < 100 && (
              <div
                className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-foreground/70 rounded-sm transition-[left] duration-700 ease-out"
                style={{ left: `${animExpectedPct}%` }}
                aria-label="Today's expected pace"
                title={`Today's pace: ${fmt(expectedByNow)}`}
              />
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-0.5 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Paid
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary/40" /> Saved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5 bg-foreground/70 rounded-sm" /> Today's pace
            </span>
          </div>
        </div>

        {/* Status message */}
        <div className={cn("rounded-md border bg-card/50 px-3 py-2 text-sm flex items-start gap-2", toneStyles.text)}>
          <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", toneStyles.accent)} />
          <span>{message}</span>
        </div>

        {/* Secondary "still to fund" line — informational only */}
        {remainingThisQuarter > 0 && (
          <p className="text-xs text-muted-foreground">
            Still to fund this quarter: <span className="tabular-nums">{fmt(remainingThisQuarter)}</span>
          </p>
        )}

        {/* Per-company breakdown */}
        <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
          <div className="rounded-lg border bg-card/50">
            <CollapsibleTrigger className="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-accent/30 transition-colors rounded-lg">
              <span className="flex items-center gap-1.5">
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", breakdownOpen && "rotate-180")}
                />
                This quarter by company
              </span>
              <span>Paid · Saved</span>
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
                      <div key={r.key} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span className={cn(empty && "text-muted-foreground")}>{r.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          <span className={cn(r.paid === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                            {fmt(r.paid)}
                          </span>
                          <span className="mx-1">·</span>
                          <span className={cn(r.saved === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                            {fmt(r.saved)}
                          </span>
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
      </CardContent>
    </Card>
  );
}
