import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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

export default function FinancialScore({
  taxProgressPct,
  monthsWithIncome,
  monthsElapsed,
  recentTxCount,
  remainingTaxThisQuarter,
  userId,
}: FinancialScoreProps) {
  const score = useMemo(() => {
    const tax = Math.min(100, Math.max(0, taxProgressPct));
    const consistency = monthsElapsed > 0 ? Math.min(100, (monthsWithIncome / monthsElapsed) * 100) : 0;
    const activity = Math.min(100, recentTxCount * 20);
    return Math.round(tax * 0.5 + consistency * 0.3 + activity * 0.2);
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

  // One dynamic suggestion (priority: tax behind > no recent income > log activity)
  const suggestion =
    taxProgressPct < 100 && remainingTaxThisQuarter > 0
      ? `Save ${fmt(remainingTaxThisQuarter)} more for taxes to improve your score`
      : monthsWithIncome < monthsElapsed
        ? "Log recent income to boost your score"
        : recentTxCount < 5
          ? "Log a few more transactions to boost your score"
          : "Keep it up — you're firing on all cylinders";

  // Glow when score increases vs last seen
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

  // Conic-gradient ring that fills proportionally to score.
  const ringBg = `conic-gradient(${ringColor} ${animScore * 3.6}deg, hsl(var(--secondary)) 0deg)`;

  return (
    <Card className={cn("border-2 transition-shadow duration-500", toneRing, glow && "shadow-[0_0_0_3px_hsl(var(--success)/0.35)]")}>
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
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Financial Score</p>
            <p className={cn("text-lg font-semibold leading-tight", toneText)}>{status}</p>
            <p className="text-sm text-muted-foreground mt-2">💡 {suggestion}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
