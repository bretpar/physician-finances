import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useInsights } from "@/hooks/useInsights";
import type { Insight, InsightSeverity } from "@/lib/insights";

const ICONS = {
  alert: AlertTriangle,
  calendar: CalendarClock,
  piggy: PiggyBank,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  check: CheckCircle2,
} as const;

const BADGE: Record<InsightSeverity, { label: string; className: string }> = {
  critical: { label: "Critical", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  action: { label: "Action Recommended", className: "border-primary/30 bg-primary/10 text-primary" },
  info: { label: "Informational", className: "border-border bg-muted text-muted-foreground" },
  success: { label: "Success", className: "border-success/30 bg-success/10 text-success" },
};

export function InsightRow({ insight, onNavigate }: { insight: Insight; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const Icon = ICONS[insight.icon];
  const badge = BADGE[insight.severity];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-card-foreground">{insight.title}</p>
            <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{insight.description}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant={insight.severity === "critical" ? "default" : "outline"}
        className="min-h-11 w-full shrink-0 sm:w-auto"
        onClick={() => {
          onNavigate?.();
          navigate(insight.to);
        }}
      >
        {insight.cta}
      </Button>
    </div>
  );
}

export function InsightsEmptyState() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-center">
      <CheckCircle2 className="mx-auto h-6 w-6 text-success" />
      <p className="mt-2 text-sm font-semibold text-card-foreground">Everything looks good.</p>
      <p className="text-sm text-muted-foreground">You're on track based on your current information.</p>
    </div>
  );
}

/** Bare list — used inside the notification sheet. */
export function InsightsList({ onNavigate }: { onNavigate?: () => void }) {
  const { insights, isReady } = useInsights();

  if (!isReady) {
    return <p className="text-sm text-muted-foreground">Pulling together your latest numbers…</p>;
  }
  if (insights.length === 0) return <InsightsEmptyState />;

  return (
    <div className="space-y-2">
      {insights.map((insight) => (
        <InsightRow key={insight.id} insight={insight} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/** Dashboard panel. */
export default function InsightsPanel() {
  return (
    <Card data-testid="insights-panel">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-card-foreground">Insights</p>
        </div>
        <InsightsList />
      </CardContent>
    </Card>
  );
}
