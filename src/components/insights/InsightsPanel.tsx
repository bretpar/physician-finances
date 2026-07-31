import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  PiggyBank,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Insight, InsightSeverity } from "@/lib/insights";
import type { DecoratedInsight } from "@/lib/insightReadState";

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

export function InsightRow({
  insight,
  unread = true,
  onNavigate,
}: {
  insight: Insight;
  unread?: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const Icon = ICONS[insight.icon];
  const badge = BADGE[insight.severity];

  return (
    <div
      data-testid={`insight-${insight.id}`}
      data-unread={unread ? "true" : "false"}
      className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3 ${
        unread ? "border-primary/30 bg-card" : "border-border bg-muted/30"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {unread ? (
          <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
        ) : (
          <span aria-hidden className="mt-2 h-2 w-2 shrink-0" />
        )}
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-sm ${unread ? "font-semibold" : "font-medium"} text-card-foreground`}>
              {insight.title}
            </p>
            <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal ${badge.className}`}>
              {badge.label}
            </span>
            {!unread && (
              <span className="text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
                Viewed
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{insight.description}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant={insight.severity === "critical" && unread ? "default" : "outline"}
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

/** Notification center list — sorted and read-state aware. */
export function NotificationsList({
  notifications,
  isReady,
  onNavigate,
}: {
  notifications: DecoratedInsight[];
  isReady: boolean;
  onNavigate?: () => void;
}) {
  if (!isReady) {
    return <p className="text-sm text-muted-foreground">Pulling together your latest numbers…</p>;
  }
  if (notifications.length === 0) return <InsightsEmptyState />;

  return (
    <div className="space-y-2">
      {notifications.map((insight) => (
        <InsightRow
          key={insight.id}
          insight={insight}
          unread={insight.unread}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
