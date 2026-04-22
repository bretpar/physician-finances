import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, AlertTriangle, Clock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter } from "@/lib/quarters";

export interface WithholdingBreakdown {
  /** W-2 withholdings from personal paychecks (user + partner) */
  personalW2: number;
  /** W-2 withholdings booked under a business (S-corp owner W-2) */
  businessW2: number;
  /** Withholdings reported on K-1 partnership distributions */
  k1: number;
  /** Withholdings reported on 1099 / Schedule C income */
  scheduleC1099: number;
  /** Quarterly estimated tax payments tagged to the CURRENT quarter */
  quarterlyPayments: number;
}

interface QuarterlyTrackerProps {
  /** Annual estimated total tax liability (federal + state + SE) */
  annualTaxLiability: number;
  /** Per-source withholding split, all YTD-to-date */
  withholding: WithholdingBreakdown;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function QuarterlyTracker({ annualTaxLiability, withholding }: QuarterlyTrackerProps) {
  const q = getCurrentQuarter();

  // ── Quarter math ──────────────────────────────────────────────────────────
  // Goal:        cumulative liability that should be covered by this quarter's
  //              deadline = annualTax × (quarter / 4).
  // Withheld:    YTD federal+state withholdings spread proportionally across
  //              the year — so by Q1 we expect 1/4 of annual withholdings,
  //              by Q2 half, etc. (Withholdings are continuous; payments are not.)
  // Payments:    quarterly estimated payments TAGGED to the current quarter
  //              count in full — they were submitted specifically for it.
  // Saved      = allocated withholdings + this-quarter payments.
  // Remaining  = max(0, goal − saved).
  const totalWithholdingYTD =
    withholding.personalW2 +
    withholding.businessW2 +
    withholding.k1 +
    withholding.scheduleC1099;

  const target = Math.max(0, (annualTaxLiability * q.quarter) / 4);
  const allocatedWithheld = (totalWithholdingYTD * q.quarter) / 4;
  const saved = Math.max(0, allocatedWithheld + withholding.quarterlyPayments);
  const remaining = Math.max(0, target - saved);

  const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 100;
  const animPct = useCountUp(pct, 1100);

  const tone: "ok" | "warn" | "bad" = pct >= 100 ? "ok" : pct >= 75 ? "warn" : "bad";
  const toneStyles = {
    ok:   { ring: "border-success/40 bg-success/[0.04]",          bar: "bg-success",     text: "text-success",     Icon: CheckCircle2, msg: "You're on track for this quarter." },
    warn: { ring: "border-warning/40 bg-warning/[0.04]",          bar: "bg-warning",     text: "text-warning",     Icon: Clock,        msg: `Save ${fmt(remaining)} more to stay on track.` },
    bad:  { ring: "border-destructive/40 bg-destructive/[0.04]",  bar: "bg-destructive", text: "text-destructive", Icon: AlertTriangle, msg: `Behind — save ${fmt(remaining)} before ${q.deadlineLabel}.` },
  }[tone];

  const { Icon } = toneStyles;

  // Per-source rows — always show all five so users see the full picture.
  // Allocated value (what counts toward this quarter's goal) shown next to gross YTD.
  const rows: { label: string; ytd: number; allocated: number }[] = [
    { label: "W-2 (personal)",          ytd: withholding.personalW2,        allocated: (withholding.personalW2 * q.quarter) / 4 },
    { label: "W-2 (business / S-corp)", ytd: withholding.businessW2,        allocated: (withholding.businessW2 * q.quarter) / 4 },
    { label: "K-1 distributions",       ytd: withholding.k1,                allocated: (withholding.k1 * q.quarter) / 4 },
    { label: "1099 / Schedule C",       ytd: withholding.scheduleC1099,     allocated: (withholding.scheduleC1099 * q.quarter) / 4 },
    { label: `${q.label} estimated payments`, ytd: withholding.quarterlyPayments, allocated: withholding.quarterlyPayments },
  ];

  return (
    <Card className={cn("border-2 transition-colors", toneStyles.ring)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Icon className={cn("h-5 w-5", toneStyles.text)} />
            Quarterly Tax Progress ({q.label})
          </CardTitle>
          <span className="text-xs text-muted-foreground">due {q.deadlineLabel}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Saved {fmt(saved)} of {fmt(target)}</span>
            <span className={cn("text-sm font-semibold tabular-nums", toneStyles.text)}>{Math.round(animPct)}%</span>
          </div>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full transition-[width] duration-700 ease-out", toneStyles.bar)}
              style={{ width: `${animPct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Goal</p>
            <p className="font-semibold tabular-nums">{fmt(target)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saved</p>
            <p className="font-semibold tabular-nums">{fmt(saved)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p className={cn("font-semibold tabular-nums", remaining > 0 ? toneStyles.text : "text-success")}>
              {fmt(remaining)}
            </p>
          </div>
        </div>

        {/* Per-source breakdown */}
        <div className="rounded-lg border bg-card/50 divide-y divide-border">
          <div className="px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Tracked withholdings</span>
            <span>YTD · counts now</span>
          </div>
          {rows.map((r) => (
            <div key={r.label} className="px-3 py-2 flex items-center justify-between text-sm">
              <span className={cn(r.ytd === 0 && "text-muted-foreground")}>{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className={cn(r.ytd === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                  {fmt(r.ytd)}
                </span>
                <span className="mx-1">·</span>
                <span>{fmt(r.allocated)}</span>
              </span>
            </div>
          ))}
        </div>

        <p className={cn("text-sm font-medium", toneStyles.text)}>💡 {toneStyles.msg}</p>
      </CardContent>
    </Card>
  );
}
