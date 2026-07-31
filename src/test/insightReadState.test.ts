import { describe, it, expect } from "vitest";
import type { Insight } from "@/lib/insights";
import {
  buildNotifications,
  insightSignature,
  isUnread,
  markAllRead,
  REMINDER_INTERVAL_MS,
  type InsightReadMap,
} from "@/lib/insightReadState";

const NOW = Date.UTC(2026, 6, 31);

const make = (over: Partial<Insight> & Pick<Insight, "id">): Insight => ({
  severity: "action",
  priority: 5,
  icon: "piggy",
  title: "Title",
  description: "Description",
  cta: "Review",
  to: "/taxes",
  ...over,
});

describe("insight read state", () => {
  it("treats never-seen insights as unread", () => {
    expect(isUnread(make({ id: "retirement" }), {}, NOW)).toBe(true);
  });

  it("clears the badge once viewed", () => {
    const insight = make({ id: "retirement" });
    const read = markAllRead([insight], {}, NOW);
    expect(isUnread(insight, read, NOW)).toBe(false);
  });

  it("re-badges when the recommendation changes significantly", () => {
    const insight = make({ id: "tax-savings-behind", severity: "critical" });
    const read = markAllRead([insight], {}, NOW);
    const changed = make({ id: "tax-savings-behind", severity: "critical", description: "Now much worse" });
    expect(isUnread(changed, read, NOW)).toBe(true);
  });

  it("re-badges after the reminder interval while unresolved", () => {
    const insight = make({ id: "hsa" });
    const read = markAllRead([insight], {}, NOW);
    expect(isUnread(insight, read, NOW + REMINDER_INTERVAL_MS - 1000)).toBe(false);
    expect(isUnread(insight, read, NOW + REMINDER_INTERVAL_MS)).toBe(true);
  });

  it("drops records for resolved insights so recurrence badges again", () => {
    const insight = make({ id: "hsa" });
    const read: InsightReadMap = markAllRead([insight], {}, NOW);
    const pruned = markAllRead([], read, NOW);
    expect(pruned.hsa).toBeUndefined();
    expect(isUnread(insight, pruned, NOW)).toBe(true);
  });

  it("sorts critical, then deadlines, then new, then viewed", () => {
    const deadline = make({ id: "quarterly-due-soon", icon: "calendar", severity: "action", priority: 2 });
    const critical = make({ id: "quarterly-overdue", severity: "critical", icon: "alert", priority: 1 });
    const newRec = make({ id: "retirement", priority: 6 });
    const viewed = make({ id: "mileage", priority: 9 });
    const read = markAllRead([viewed], {}, NOW);
    const out = buildNotifications([viewed, newRec, deadline, critical], read, NOW);
    expect(out.map((i) => i.id)).toEqual([
      "quarterly-overdue",
      "quarterly-due-soon",
      "retirement",
      "mileage",
    ]);
    expect(out[3].unread).toBe(false);
  });

  it("signature is stable for identical content", () => {
    expect(insightSignature(make({ id: "hsa" }))).toBe(insightSignature(make({ id: "hsa" })));
  });
});
