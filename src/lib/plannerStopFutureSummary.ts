/**
 * Summary helper for the "Stop future income" confirmation dialog.
 *
 * Planner deletions never touch ledger history: only planned occurrences dated
 * today or later are removed. This helper counts exactly what will disappear so
 * the confirm dialog can state it plainly.
 */

export interface StopFutureOccurrence {
  date: string; // YYYY-MM-DD
  grossAmount: number;
  streamId: string;
  type: "paycheck" | "bonus";
  matchStatus?: string;
  isSkipped?: boolean;
}

export interface StopFutureSummary {
  /** Planned future occurrences that will be removed. */
  removedCount: number;
  /** Gross income no longer projected. */
  removedGross: number;
  /** Future bonus events included in removedCount. */
  removedBonusCount: number;
  /** Future occurrences already converted to the ledger — these stay. */
  keptConvertedCount: number;
  /** Occurrences dated before today — always kept. */
  keptPastCount: number;
  /** First / last date of the removed range (null when nothing is removed). */
  firstRemovedDate: string | null;
  lastRemovedDate: string | null;
  /** True when the stream has history and will be truncated instead of deleted. */
  willTruncate: boolean;
}

/** Local YYYY-MM-DD for "today". */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildStopFutureSummary(
  occurrences: StopFutureOccurrence[],
  streamId: string,
  now: Date = new Date(),
): StopFutureSummary {
  const today = todayISO(now);
  const mine = occurrences.filter((o) => o.streamId === streamId);

  let removedCount = 0;
  let removedGross = 0;
  let removedBonusCount = 0;
  let keptConvertedCount = 0;
  let keptPastCount = 0;
  let firstRemovedDate: string | null = null;
  let lastRemovedDate: string | null = null;

  for (const o of mine) {
    if (o.date < today) {
      keptPastCount += 1;
      continue;
    }
    // Converted occurrences already produced a ledger record — never removed.
    if (o.matchStatus === "converted") {
      keptConvertedCount += 1;
      continue;
    }
    if (o.isSkipped) continue; // already not projected
    removedCount += 1;
    removedGross += Number(o.grossAmount) || 0;
    if (o.type === "bonus") removedBonusCount += 1;
    if (!firstRemovedDate || o.date < firstRemovedDate) firstRemovedDate = o.date;
    if (!lastRemovedDate || o.date > lastRemovedDate) lastRemovedDate = o.date;
  }

  return {
    removedCount,
    removedGross,
    removedBonusCount,
    keptConvertedCount,
    keptPastCount,
    firstRemovedDate,
    lastRemovedDate,
    willTruncate: keptPastCount + keptConvertedCount > 0,
  };
}
