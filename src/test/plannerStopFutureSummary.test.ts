import { describe, it, expect } from "vitest";
import { buildStopFutureSummary, type StopFutureOccurrence } from "@/lib/plannerStopFutureSummary";

const NOW = new Date(2026, 7, 14); // Aug 14 2026 local

const occ = (o: Partial<StopFutureOccurrence>): StopFutureOccurrence => ({
  date: "2026-09-01",
  grossAmount: 1000,
  streamId: "s1",
  type: "paycheck",
  ...o,
});

describe("buildStopFutureSummary", () => {
  it("counts only future, non-converted occurrences of the stream", () => {
    const s = buildStopFutureSummary(
      [
        occ({ date: "2026-07-01" }),
        occ({ date: "2026-08-14" }),
        occ({ date: "2026-09-01" }),
        occ({ date: "2026-09-15", streamId: "other" }),
      ],
      "s1",
      NOW,
    );
    expect(s.removedCount).toBe(2);
    expect(s.removedGross).toBe(2000);
    expect(s.keptPastCount).toBe(1);
    expect(s.firstRemovedDate).toBe("2026-08-14");
    expect(s.lastRemovedDate).toBe("2026-09-01");
    expect(s.willTruncate).toBe(true);
  });

  it("keeps converted future occurrences out of the removal count", () => {
    const s = buildStopFutureSummary(
      [occ({ date: "2026-09-01", matchStatus: "converted" }), occ({ date: "2026-09-15" })],
      "s1",
      NOW,
    );
    expect(s.removedCount).toBe(1);
    expect(s.keptConvertedCount).toBe(1);
  });

  it("ignores skipped occurrences and tallies bonuses", () => {
    const s = buildStopFutureSummary(
      [
        occ({ date: "2026-09-01", isSkipped: true }),
        occ({ date: "2026-10-01", type: "bonus", grossAmount: 5000 }),
      ],
      "s1",
      NOW,
    );
    expect(s.removedCount).toBe(1);
    expect(s.removedBonusCount).toBe(1);
    expect(s.removedGross).toBe(5000);
  });

  it("reports no truncation for a fully future stream", () => {
    const s = buildStopFutureSummary([occ({ date: "2026-09-01" })], "s1", NOW);
    expect(s.willTruncate).toBe(false);
    expect(s.removedCount).toBe(1);
  });

  it("handles a stream with nothing planned ahead", () => {
    const s = buildStopFutureSummary([occ({ date: "2026-01-01" })], "s1", NOW);
    expect(s.removedCount).toBe(0);
    expect(s.firstRemovedDate).toBeNull();
  });
});
