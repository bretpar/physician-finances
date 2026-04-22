import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, AlertTriangle, Clock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter } from "@/lib/quarters";

/** Per-company current-quarter row split into paid (real withholdings) vs saved (reserves). */
export interface CompanyQuarterRow {
  /** Stable key (company id or synthetic) */
  key: string;
  /** Display label — typically company name; can include a type hint in parens */
  label: string;
  /** Amount actually withheld / paid this quarter (federal + state withholding) */
  paid: number;
  /** Amount set aside for taxes this quarter (actual_withholding + additional_tax_reserve) */
  saved: number;
}

interface QuarterlyTrackerProps {
  /** Annual estimated total tax liability for the active withholding method */
  annualTaxLiability: number;
  /** Per-company breakdown of paid vs saved THIS QUARTER */
  companies: CompanyQuarterRow[];
  /** Estimated tax payments actually paid to IRS/state this quarter */
  quarterlyPayments: number;
  /** Label of the active withholding method, e.g. "Flat 22%" or "Dynamic (actual)" */
  methodLabel?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function QuarterlyTracker({
  annualTaxLiability,
  companies,
  quarterlyPayments,
  methodLabel,
}: QuarterlyTrackerProps) {
  const q = getCurrentQuarter();
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // ── Quarter math (CURRENT QUARTER ONLY) ───────────────────────────────────
  // Goal      = annualTax / 4 (this quarter's slice only — not cumulative)
  // Paid      = company withholdings this quarter + estimated tax payments this quarter
  // Saved     = reserves set aside this quarter (not yet submitted)
  // Remaining = max(0, goal − paid − saved)
  const quarterGoal = Math.max(0, annualTaxLiability / 4);
  const paidFromCompanies = companies.reduce((s, c) => s + c.paid, 0);
  const paidThisQuarter = paidFromCompanies + quarterlyPayments;
  const savedThisQuarter = companies.reduce((s, c) => s + c.saved, 0);
  const progressThisQuarter = paidThisQuarter + savedThisQuarter;
  const remainingThisQuarter = Math.max(0, quarterGoal - progressThisQuarter);

  const pct = quarterGoal > 0 ? Math.min(100, (progressThisQuarter / quarterGoal) * 100) : 100;
  const paidPct = quarterGoal > 0 ? Math.min(100, (paidThisQuarter / quarterGoal) * 100) : 0;
  const savedPct = Math.max(0, Math.min(100 - paidPct, quarterGoal > 0 ? (savedThisQuarter / quarterGoal) * 100 : 0));
  const animPct = useCountUp(pct, 1100);
  const animPaidPct = useCountUp(paidPct, 1100);
  const animSavedPct = useCountUp(savedPct, 1100);

  const tone: "ok" | "warn" | "bad" = pct >= 100 ? "ok" : pct >= 75 ? "warn" : "bad";
  const toneStyles = {
    ok:   { ring: "border-success/40 bg-success/[0.04]",          text: "text-success",     Icon: CheckCircle2, msg: "You're on track for this quarter." },
    warn: { ring: "border-warning/40 bg-warning/[0.04]",          text: "text-warning",     Icon: Clock,        msg: `Set aside ${fmt(remainingThisQuarter)} more this quarter.` },
    bad:  { ring: "border-destructive/40 bg-destructive/[0.04]",  text: "text-destructive", Icon: AlertTriangle, msg: `Behind — ${fmt(remainingThisQuarter)} short before ${q.deadlineLabel}.` },
  }[tone];

  const { Icon } = toneStyles;

  // Build breakdown rows: companies (sorted by total contribution desc) + estimated payments at end.
  const sortedCompanies = [...companies].sort(
    (a, b) => (b.paid + b.saved) - (a.paid + a.saved),
  );
  const rows: { key: string; label: string; paid: number; saved: number }[] = [
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
            <Icon className={cn("h-5 w-5", toneStyles.text)} />
            Quarterly Tax Progress ({q.label})
          </CardTitle>
          <span className="text-xs text-muted-foreground">due {q.deadlineLabel}</span>
        </div>
        {methodLabel && (
          <p className="text-xs text-muted-foreground mt-1">Based on: {methodLabel}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">
              Paid {fmt(paidThisQuarter)} of {fmt(quarterGoal)}
            </span>
            <span className={cn("text-sm font-semibold tabular-nums", toneStyles.text)}>
              {Math.round(animPct)}%
            </span>
          </div>
          {/* Stacked bar: Paid (primary) + Saved (accent/muted) */}
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary flex">
            <div
              className="h-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${animPaidPct}%` }}
            />
            <div
              className="h-full bg-primary/40 transition-[width] duration-700 ease-out"
              style={{ width: `${animSavedPct}%` }}
            />
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
              Paid
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary/40" />
              Saved
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="font-semibold tabular-nums">{fmt(paidThisQuarter)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saved</p>
            <p className="font-semibold tabular-nums">{fmt(savedThisQuarter)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p className={cn("font-semibold tabular-nums", remainingThisQuarter > 0 ? toneStyles.text : "text-success")}>
              {fmt(remainingThisQuarter)}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground italic">
          Saved amounts are not yet submitted tax payments.
        </p>

        {/* Per-company current-quarter breakdown */}
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

        <p className={cn("text-sm font-medium", toneStyles.text)}>💡 {toneStyles.msg}</p>
      </CardContent>
    </Card>
  );
}
