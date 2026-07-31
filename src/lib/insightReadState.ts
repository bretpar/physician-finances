/**
 * Notification read-state — DISPLAY LOGIC ONLY.
 *
 * Models the notification bell after Apple Mail / Slack:
 *  - Badge = something new (unread).
 *  - Opening the notification center clears the badge.
 *  - Previously viewed insights stay in the list, marked as viewed.
 *
 * No tax math, no API calls, no backend writes. State is persisted in
 * localStorage by `useInsightReadState`.
 */
import type { Insight } from "@/lib/insights";

export interface InsightReadRecord {
  /** Content fingerprint at the time it was last marked read. */
  signature: string;
  /** Epoch ms the user last viewed this insight. */
  readAt: number;
}

export type InsightReadMap = Record<string, InsightReadRecord>;

/** Re-notify about an unresolved recommendation at most this often. */
export const REMINDER_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Deadlines inside this window re-badge even if already viewed. */
export const DEADLINE_REMINDER_DAYS = 7;

/**
 * Fingerprint of an insight's meaningful content. A change here means the
 * recommendation changed significantly and deserves a fresh badge.
 */
export function insightSignature(insight: Insight): string {
  return `${insight.severity}|${insight.title}|${insight.description}`;
}

/** True when this insight should contribute to the red badge. */
export function isUnread(
  insight: Insight,
  read: InsightReadMap,
  now: number = Date.now(),
): boolean {
  const record = read[insight.id];
  // Never viewed → new recommendation.
  if (!record) return true;
  // Content changed significantly since it was viewed.
  if (record.signature !== insightSignature(insight)) return true;
  // Still unresolved after the reminder interval → nudge again.
  if (now - record.readAt >= REMINDER_INTERVAL_MS) return true;
  return false;
}

const SEVERITY_RANK: Record<Insight["severity"], number> = {
  critical: 0,
  action: 1,
  info: 2,
  success: 3,
};

export interface DecoratedInsight extends Insight {
  unread: boolean;
}

/**
 * Sort order inside the notification center:
 *  1. Critical
 *  2. Upcoming deadlines (calendar icon)
 *  3. New (unread) recommendations
 *  4. General insights
 *  5. Older viewed insights
 */
export function sortNotifications(items: DecoratedInsight[]): DecoratedInsight[] {
  const rank = (i: DecoratedInsight) => {
    if (i.severity === "critical") return 0;
    if (i.icon === "calendar") return 1;
    if (i.unread) return 2;
    return 3;
  };
  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.priority - b.priority,
  );
}

/** Decorate + sort in one step. */
export function buildNotifications(
  insights: Insight[],
  read: InsightReadMap,
  now: number = Date.now(),
): DecoratedInsight[] {
  return sortNotifications(insights.map((i) => ({ ...i, unread: isUnread(i, read, now) })));
}

/** Mark every currently-visible insight as viewed. */
export function markAllRead(
  insights: Insight[],
  read: InsightReadMap,
  now: number = Date.now(),
): InsightReadMap {
  const next: InsightReadMap = { ...read };
  for (const insight of insights) {
    next[insight.id] = { signature: insightSignature(insight), readAt: now };
  }
  // Drop records for insights that no longer exist (resolved) so a future
  // recurrence badges again.
  const live = new Set(insights.map((i) => i.id));
  for (const key of Object.keys(next)) {
    if (!live.has(key as Insight["id"])) delete next[key];
  }
  return next;
}
