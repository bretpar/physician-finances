import { describe, it, expect } from "vitest";
import {
  computeCatchUpRecommendation,
  expectedOrdinaryCoverageForEvents,
} from "@/lib/catchUpRecommendation";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const now = new Date(2026, 7, 1);
const deadline = new Date(2026, 8, 15);
const events = [
  { date: "2026-08-15T12:00:00", grossAmount: 2_000 },
  { date: "2026-09-01T12:00:00", grossAmount: 2_000 },
];

describe("catch-up subtracts expected ordinary reserves", () => {
  it("fully funded by ordinary future reserves → $0 catch-up", () => {
    const ordinary = expectedOrdinaryCoverageForEvents(events, now, deadline, 0.25);
    expect(ordinary).toBe(1_000);
    const r = computeCatchUpRecommendation({ quarterTarget: 1_000, coveredSoFar: 0, remainingOpportunities: 2, expectedOrdinaryCoverage: ordinary });
    expect(r.quarterlyAdjustmentAmount).toBe(0);
  });

  it("partially funded → only the genuine gap is allocated", () => {
    const r = computeCatchUpRecommendation({ quarterTarget: 1_400, coveredSoFar: 0, remainingOpportunities: 2, expectedOrdinaryCoverage: 1_000 });
    expect(r.uncoveredGap).toBe(400);
    expect(r.quarterlyAdjustmentAmount).toBe(200);
  });

  it("recorded reserves are credited once", () => {
    const r = computeCatchUpRecommendation({ quarterTarget: 1_500, coveredSoFar: 300, remainingOpportunities: 2, expectedOrdinaryCoverage: 1_000 });
    expect(r.totalShortfallByDeadline).toBe(1_200);
    expect(r.quarterlyAdjustmentAmount).toBe(100);
  });

  it("no remaining projected income → no invalid allocation", () => {
    expect(expectedOrdinaryCoverageForEvents([], now, deadline, 0.25)).toBe(0);
    const r = computeCatchUpRecommendation({ quarterTarget: 1_000, coveredSoFar: 400, remainingOpportunities: 0, expectedOrdinaryCoverage: 0 });
    expect(r.remainingOpportunities).toBe(1);
    expect(r.quarterlyAdjustmentAmount).toBe(600);
    expect(Number.isFinite(r.quarterlyAdjustmentAmount)).toBe(true);
  });

  it("quarter target and progress are unchanged by the new coverage", () => {
    const q = buildQuarterRecommendation({
      year: 2026, quarter: 3, annualTaxLiability: 4_000, quarterMethod: "even",
      projectedPaychecks: [{ date: "2026-08-15", grossAmount: 8_000 }, { date: "2026-09-01", grossAmount: 8_000 }],
      now,
    } as any);
    expect(q.quarterTarget).toBe(1_000);
    expect(q.progressAmount).toBe(0);
    expect(q.expectedOrdinaryCoverage).toBeGreaterThan(0);
  });
});
