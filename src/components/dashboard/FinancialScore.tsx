import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/useCountUp";

interface FinancialScoreProps {
  /** % of quarterly tax target already covered (0–100+) */
  taxProgressPct: number;
  /** Months YTD that have at least one income event */
  monthsWithIncome: number;
  /** Months elapsed YTD (1–12) */
  monthsElapsed: number;
  /** Count of recent transactions (last 30d) */
  recentTxCount: number;
  /** Remaining tax to save this quarter (drives the suggestion) */
  remainingTaxThisQuarter: number;
  userId?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const RECENT_TX_CAP = 5;

export default function FinancialScore({
  taxProgressPct,
  monthsWithIncome,
  monthsElapsed,
  recentTxCount,
  remainingTaxThisQuarter,
  userId,
}: FinancialScoreProps) {
  const [open, setOpen] = useState(false);

  const { score, taxComponent, consistencyComponent, activityComponent } = useMemo(() => {
    const tax = Math.min(100, Math.max(0, taxProgressPct));
    const consistency = monthsElapsed > 0 ? Math.min(100, (monthsWithIncome / monthsElapsed) * 100) : 0;
    const activity = Math.min(100, recentTxCount * 20);
    return {
      taxComponent: tax,
      consistencyComponent: consistency,
      activityComponent: activity,
      score: Math.round(tax * 0.5 + consistency * 0.3 + activity * 0.2),
    };
  }, [taxProgressPct, monthsWithIncome, monthsElapsed, recentTxCount]);

  const animScore = useCountUp(score, 1100);

  const tone: "ok" | "warn" | "bad" = score >= 80 ? "ok" : score >= 60 ? "warn" : "bad";
  const toneText = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-destructive";
  const toneRing = tone === "ok" ? "border-success/40 bg-success/[0.04]" : tone === "warn" ? "border-warning/40 bg-warning/[0.04]" : "border-destructive/40 bg-destructive/[0.04]";
  const ringColor = tone === "ok" ? "hsl(var(--success))" : tone === "warn" ? "hsl(var(--warning))" : "hsl(var(--destructive))";

  const status =
    score >= 80 ? "You're in great shape" :
    score >= 60 ? "Doing well — small improvements available" :
    "Needs attention";

  const suggestion =
    taxProgressPct < 100 && remainingTaxThisQuarter > 0
      ? `Save ${fmt(remainingTaxThisQuarter)} more toward this quarter's tax target to improve your score`
      : monthsWithIncome < monthsElapsed
        ? "Log recent income to boost your score"
        : recentTxCount < RECENT_TX_CAP
          ? "Log a few more transactions to boost your score"
          : "Keep it up — you're firing on all cylinders";

  const [glow, setGlow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !userId) return;
    const key = `dashboard:lastScore:${userId}`;
    const prev = Number(localStorage.getItem(key) || "0");
    if (score > prev) {
      setGlow(true);
      const t = setTimeout(() => setGlow(false), 2200);
      localStorage.setItem(key, String(score));
      return () => clearTimeout(t);
    }
    localStorage.setItem(key, String(score));
  }, [score, userId]);

  const ringBg = `conic-gradient(${ringColor} ${animScore * 3.6}deg, hsl(var(--secondary)) 0deg)`;

  return (
    <Card className={cn("border-2 transition-shadow duration-500", toneRing, glow && "shadow-[0_0_0_3px_hsl(var(--success)/0.35)]")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
            aria-expanded={open}
            aria-label={open ? "Hide score breakdown" : "Show score breakdown"}
          >
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-5">
                <div
                  className="relative h-24 w-24 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: ringBg }}
                  aria-label={`Financial score: ${score} out of 100`}
                >
                  <div className="h-[78px] w-[78px] rounded-full bg-card flex flex-col items-center justify-center">
                    <span className={cn("text-3xl font-bold tabular-nums leading-none", toneText)}>{Math.round(animScore)}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">/ 100</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Financial Score</p>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span>{open ? "Hide" : "Tap to see why"}</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                    </div>
                  </div>
                  <p className={cn("text-lg font-semibold leading-tight mt-1", toneText)}>{status}</p>
                  <p className="text-sm text-muted-foreground mt-2">💡 {suggestion}</p>
                </div>
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-5 pb-5 -mt-2 space-y-4">
            <div className="h-px bg-border" />
            <p className="text-sm text-muted-foreground">
              Your score is based on tax readiness, income consistency, and recent activity.
            </p>

            <div className="space-y-3">
              <BreakdownRow
                title="Tax readiness"
                weight="50% weight"
                value={`${Math.round(taxComponent)}%`}
                explanation="This compares taxes paid/saved this quarter against your quarter target."
              />
              <BreakdownRow
                title="Income consistency"
                weight="30% weight"
                value={`${monthsWithIncome} / ${monthsElapsed} months`}
                explanation="Logging income each month helps keep your annual tax estimate accurate."
              />
              <BreakdownRow
                title="Recent activity"
                weight="20% weight"
                value={`${Math.min(recentTxCount, RECENT_TX_CAP)} / ${RECENT_TX_CAP} transactions`}
                explanation="Recent transactions keep your dashboard current."
              />
            </div>

            <p className="text-xs text-muted-foreground italic">
              Saved tax reserve improves this score. It is not counted as an estimated tax payment until you log a payment.
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" variant="outline">
                <Link to="/tax-reserve">Log tax savings</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/taxes">Review taxes</Link>
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function BreakdownRow({
  title,
  weight,
  value,
  explanation,
}: {
  title: string;
  weight: string;
  value: string;
  explanation: string;
}) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-card-foreground">{title}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{weight}</p>
        </div>
        <p className="text-sm font-medium tabular-nums text-card-foreground shrink-0">{value}</p>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{explanation}</p>
    </div>
  );
}
