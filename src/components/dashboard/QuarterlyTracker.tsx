import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, AlertTriangle, Clock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter } from "@/lib/quarters";

/** Per-company (or per-source) YTD withholding row. */
export interface CompanyWithholdingRow {
  /** Stable key (company id or synthetic key) */
  key: string;
  /** Display label — typically company name; can include a type hint in parens */
  label: string;
  /** YTD withholding amount in dollars */
  amount: number;
}

interface QuarterlyTrackerProps {
  /** Annual estimated total tax liability for the active withholding method */
  annualTaxLiability: number;
  /** YTD withholdings grouped by company (W-2, K-1, 1099 all aggregated per company) */
  companies: CompanyWithholdingRow[];
  /** Quarterly estimated payments tagged to the CURRENT quarter */
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

  // ── Quarter math ──────────────────────────────────────────────────────────
  // Goal      = annualTax × (quarter / 4)  — cumulative liability through this quarter's deadline.
  // Saved     = (YTD withholdings × quarter/4) + this-quarter estimated payments.
  // Remaining = max(0, goal − saved).
  const totalWithholdingYTD = companies.reduce((s, c) => s + c.amount, 0);
  const target = Math.max(0, (annualTaxLiability * q.quarter) / 4);
  const allocatedWithheld = (totalWithholdingYTD * q.quarter) / 4;
  const saved = Math.max(0, allocatedWithheld + quarterlyPayments);
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

  // Build breakdown rows: companies (sorted by amount desc) + estimated payments at end.
  const sortedCompanies = [...companies].sort((a, b) => b.amount - a.amount);
  const rows: { key: string; label: string; ytd: number; allocated: number }[] = [
    ...sortedCompanies.map((c) => ({
      key: c.key,
      label: c.label,
      ytd: c.amount,
      allocated: (c.amount * q.quarter) / 4,
    })),
    {
      key: "__quarterly_payments__",
      label: `${q.label} estimated payments`,
      ytd: quarterlyPayments,
      allocated: quarterlyPayments,
    },
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
        {methodLabel && (
          <p className="text-xs text-muted-foreground mt-1">Based on: {methodLabel}</p>
        )}
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

        {/* Per-company breakdown */}
        <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
          <div className="rounded-lg border bg-card/50">
            <CollapsibleTrigger className="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-accent/30 transition-colors rounded-lg">
              <span className="flex items-center gap-1.5">
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", breakdownOpen && "rotate-180")}
                />
                Tracked withholdings by company
              </span>
              <span>YTD · counts now</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border border-t">
                {rows.length === 1 && rows[0].ytd === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    No withholdings tracked yet for this year.
                  </div>
                ) : (
                  rows.map((r) => (
                    <div key={r.key} className="px-3 py-2 flex items-center justify-between text-sm">
                      <span className={cn(r.ytd === 0 && "text-muted-foreground")}>{r.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        <span className={cn(r.ytd === 0 ? "text-muted-foreground" : "text-foreground font-medium")}>
                          {fmt(r.ytd)}
                        </span>
                        <span className="mx-1">·</span>
                        <span>{fmt(r.allocated)}</span>
                      </span>
                    </div>
                  ))
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
