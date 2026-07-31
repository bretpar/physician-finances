import { describe, it, expect } from "vitest";
import { computeQuarterPace, type QuarterPaceInput } from "@/lib/quarterPaceStatus";

// Q3-like window: Jul 1 - Oct 1. "Today" is Aug 15 => ~50% elapsed.
const base: QuarterPaceInput = {
  quarterTarget: 30_000,
  progressAmount: 15_000,
  start: new Date(2026, 6, 1),
  end: new Date(2026, 9, 1),
  daysUntilDue: 31,
  quarterLabel: "Q3",
  deadlineLabel: "Sep 15",
  now: new Date(2026, 7, 15),
};

const run = (o: Partial<QuarterPaceInput> = {}) => computeQuarterPace({ ...base, ...o });

describe("computeQuarterPace", () => {
  it("prorates the quarterly target by elapsed time instead of using the full target", () => {
    const r = run();
    expect(r.elapsedFraction).toBeGreaterThan(0.4);
    expect(r.elapsedFraction).toBeLessThan(0.6);
    expect(r.recommendedToDate).toBeLessThan(base.quarterTarget);
    expect(r.status).toBe("on_track");
    expect(r.tone).toBe("success");
  });

  it("does not warn a user who has half the full quarter target mid-quarter", () => {
    expect(run().needsAction).toBe(false);
  });

  it("returns success between 95% and 105% of today's recommendation", () => {
    const rec = run().recommendedToDate;
    expect(run({ progressAmount: rec * 0.96 }).tone).toBe("success");
    expect(run({ progressAmount: rec * 1.04 }).tone).toBe("success");
  });

  it("returns an informational status between 80% and 95%", () => {
    const rec = run().recommendedToDate;
    const r = run({ progressAmount: rec * 0.85 });
    expect(r.status).toBe("slightly_behind");
    expect(r.tone).toBe("info");
    expect(r.detail).toContain("back on track");
    expect(r.needsAction).toBe(false);
  });

  it("returns a warning below 80%", () => {
    const rec = run().recommendedToDate;
    const r = run({ progressAmount: rec * 0.5 });
    expect(r.status).toBe("behind");
    expect(r.tone).toBe("warning");
    expect(r.needsAction).toBe(true);
  });

  it("returns ahead above 105%", () => {
    const rec = run().recommendedToDate;
    expect(run({ progressAmount: rec * 1.5 }).status).toBe("ahead");
  });

  it("flags overdue only when the deadline passed and pace is short", () => {
    const rec = run().recommendedToDate;
    expect(run({ daysUntilDue: -2, progressAmount: rec * 0.5 }).status).toBe("overdue");
    expect(run({ daysUntilDue: -2, progressAmount: rec }).status).toBe("on_track");
  });

  it("is not applicable without a target or for withholding-only users", () => {
    expect(run({ quarterTarget: 0 }).status).toBe("not_applicable");
    expect(run({ showQuarterly: false }).status).toBe("not_applicable");
  });

  it("treats a not-yet-started quarter as neutral", () => {
    expect(run({ now: new Date(2026, 5, 1), progressAmount: 0 }).status).toBe("future");
  });

  it("tolerates invalid numbers", () => {
    const r = run({ quarterTarget: Number.NaN, progressAmount: Number.NaN });
    expect(r.status).toBe("not_applicable");
    expect(Number.isFinite(r.paceRatio)).toBe(true);
  });
});
