import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";
import { getCurrentQuarter, getQuarterPayments } from "@/lib/quarters";
import type { TaxPayment } from "@/hooks/useTaxPayments";

interface QuarterlyTrackerProps {
  /** Annual estimated total tax liability */
  annualTaxLiability: number;
  /** Total YTD federal + state withholdings already covered */
  totalWithheldYTD: number;
  /** Tax payments user has already submitted */
  payments: TaxPayment[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function QuarterlyTracker({ annualTaxLiability, totalWithheldYTD, payments }: QuarterlyTrackerProps) {
  const q = getCurrentQuarter();

  // Target = the cumulative amount that should be covered by this quarter's deadline.
  // Saved = quarter-tagged payments + pro-rata share of YTD withholdings (W-2/K-1/1099 etc).
  // Remaining = how much more to set aside before the deadline.
  const target = Math.max(0, (annualTaxLiability * q.quarter) / 4);
  const quarterPayments = getQuarterPayments(payments, q.label);
  // Withholdings are spread across the year; allocate them proportionally to current quarter.
  const allocatedWithheld = (totalWithheldYTD * q.quarter) / 4;
  const saved = Math.max(0, quarterPayments + allocatedWithheld);
  const remaining = Math.max(0, target - saved);

  const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 100;
  const animPct = useCountUp(pct, 1100);

  const tone: "ok" | "warn" | "bad" = pct >= 100 ? "ok" : pct >= 75 ? "warn" : "bad";
  const toneStyles = {
    ok:   { ring: "border-success/40 bg-success/[0.04]",     bar: "bg-success",    text: "text-success",    Icon: CheckCircle2, msg: "You're on track for this quarter." },
    warn: { ring: "border-warning/40 bg-warning/[0.04]",     bar: "bg-warning",    text: "text-warning",    Icon: Clock,        msg: `Save ${fmt(remaining)} more to stay on track.` },
    bad:  { ring: "border-destructive/40 bg-destructive/[0.04]", bar: "bg-destructive", text: "text-destructive", Icon: AlertTriangle, msg: `Behind — save ${fmt(remaining)} before ${q.deadlineLabel}.` },
  }[tone];

  const { Icon } = toneStyles;

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
          {/* Custom progress (so we can color the fill via tone) */}
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full transition-[width] duration-700 ease-out", toneStyles.bar)}
              style={{ width: `${animPct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Target</p>
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

        <p className={cn("text-sm font-medium", toneStyles.text)}>💡 {toneStyles.msg}</p>
      </CardContent>
    </Card>
  );
}
