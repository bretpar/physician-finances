import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
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

/**
 * Compact inbox-style notification row. Collapsed it shows icon, title, badge
 * and a single-line summary; the CTA appears only once expanded by tap.
 */
export function InsightRow({
  insight,
  unread = true,
  expanded = false,
  onToggle,
  onNavigate,
}: {
  insight: Insight;
  unread?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const Icon = ICONS[insight.icon];
  const badge = BADGE[insight.severity];

  return (
    <div
      data-testid={`insight-${insight.id}`}
      data-unread={unread ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
      className={`rounded-lg border ${unread ? "border-primary/30 bg-card" : "border-border bg-muted/30"}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {unread ? (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
        ) : (
          <span aria-hidden className="h-2 w-2 shrink-0" />
        )}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`text-sm ${unread ? "font-semibold" : "font-medium"} text-card-foreground`}>
              {insight.title}
            </span>
            <span
              className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal ${badge.className}`}
            >
              {badge.label}
            </span>
          </span>
          {!expanded && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {insight.description}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          <p className="text-sm text-muted-foreground">{insight.description}</p>
          <Button
            size="sm"
            variant={insight.severity === "critical" ? "default" : "outline"}
            className="min-h-11 w-full sm:w-auto"
            onClick={() => {
              onNavigate?.();
              navigate(insight.to);
            }}
          >
            {insight.cta}
          </Button>
        </div>
      )}
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

/** Notification center list — inbox style, one row expanded at a time. */
export function NotificationsList({
  notifications,
  isReady,
  onNavigate,
}: {
  notifications: DecoratedInsight[];
  isReady: boolean;
  onNavigate?: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!isReady) {
    return <p className="text-sm text-muted-foreground">Pulling together your latest numbers…</p>;
  }
  if (notifications.length === 0) return <InsightsEmptyState />;

  return (
    <div className="space-y-1.5">
      {notifications.map((insight) => (
        <InsightRow
          key={insight.id}
          insight={insight}
          unread={insight.unread}
          expanded={expandedId === insight.id}
          onToggle={() => setExpandedId((prev) => (prev === insight.id ? null : insight.id))}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
