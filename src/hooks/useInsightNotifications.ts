/**
 * Persists notification read-state per user in localStorage. Presentation-only
 * state — nothing is written to the backend.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInsights, type AssistantSummary } from "@/hooks/useInsights";
import {
  buildNotifications,
  markAllRead,
  type DecoratedInsight,
  type InsightReadMap,
} from "@/lib/insightReadState";

const storageKey = (userId?: string) => `paycheckmd:insights:read:${userId ?? "anon"}`;

function load(key: string): InsightReadMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as InsightReadMap) : {};
  } catch {
    return {};
  }
}

export function useInsightNotifications(): {
  notifications: DecoratedInsight[];
  unreadCount: number;
  isReady: boolean;
  assistant: AssistantSummary;
  markRead: () => void;
} {
  const { user } = useAuth();
  const { insights, isReady, assistant } = useInsights();
  const key = storageKey(user?.id);
  const [read, setRead] = useState<InsightReadMap>(() => load(key));

  useEffect(() => {
    setRead(load(key));
  }, [key]);

  const notifications = useMemo(() => buildNotifications(insights, read), [insights, read]);
  const unreadCount = notifications.filter((n) => n.unread).length;

  const markRead = useCallback(() => {
    setRead((prev) => {
      const next = markAllRead(insights, prev);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable — badge simply won't persist as read */
      }
      return next;
    });
  }, [insights, key]);

  return { notifications, unreadCount, isReady, assistant, markRead };
}
