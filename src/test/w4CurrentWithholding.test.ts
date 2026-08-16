import { describe, it, expect } from "vitest";
import {
  computeW4RecommendedChange,
  buildEmployerW4Recommendations,
  allocateW4SurplusReduction,
  resolveCurrentExtraW4,
  W4_CHANGE_TOLERANCE,
} from "@/lib/w4CurrentWithholding";

describe("resolveCurrentExtraW4", () => {
  it("treats missing / invalid / negative values as zero", () => {
    expect(resolveCurrentExtraW4(undefined)).toBe(0);
    expect(resolveCurrentExtraW4(null)).toBe(0);
    expect(resolveCurrentExtraW4("abc")).toBe(0);
    expect(resolveCurrentExtraW4(-50)).toBe(0);
    expect(resolveCurrentExtraW4("125.5")).toBe(125.5);
  });
});

describe("computeW4RecommendedChange", () => {
  it("recommends the difference between target and current", () => {
    const r = computeW4RecommendedChange(300, 200);
    expect(r.recommendedExtraPerPaycheck).toBe(300);
    expect(r.direction).toBe("increase");
    expect(r.changeAmountPerPaycheck).toBe(100);
  });

  it("reports no change inside the tolerance band", () => {
    const r = computeW4RecommendedChange(200 + W4_CHANGE_TOLERANCE - 1, 200);
    expect(r.direction).toBe("none");
    expect(r.label).toBe("No change recommended");
  });

  it("recommends a decrease when the target is below the current amount", () => {
    const r = computeW4RecommendedChange(0, 150);
    expect(r.recommendedExtraPerPaycheck).toBe(0);
    expect(r.direction).toBe("decrease");
    expect(r.changeAmountPerPaycheck).toBe(150);
  });

  it("is satisfied when the current amount already equals the target", () => {
    const r = computeW4RecommendedChange(250, 250);
    expect(r.recommendedExtraPerPaycheck).toBe(250);
    expect(r.direction).toBe("none");
  });

  it("target is a stable value — it does not move with the current amount", () => {
    const a = computeW4RecommendedChange(1400, 0);
    const b = computeW4RecommendedChange(1400, 1350);
    expect(a.recommendedExtraPerPaycheck).toBe(1400);
    expect(b.recommendedExtraPerPaycheck).toBe(1400);
    expect(b.changeAmountPerPaycheck).toBe(50);
    expect(b.direction).toBe("increase");
  });
});

describe("allocateW4SurplusReduction", () => {
  it("only reduces employers that have extra withholding on file", () => {
    const out = allocateW4SurplusReduction(
      [
        { key: "a", currentExtraPerPaycheck: 100, remainingPaychecks: 10 },
        { key: "b", currentExtraPerPaycheck: 0, remainingPaychecks: 10 },
      ],
      500,
    );
    expect(out.get("b")).toBeUndefined();
    expect(out.get("a")).toBeCloseTo(50, 5);
  });

  it("caps the reduction at the employer's own current extra", () => {
    const out = allocateW4SurplusReduction(
      [{ key: "a", currentExtraPerPaycheck: 40, remainingPaychecks: 5 }],
      100000,
    );
    expect(out.get("a")).toBeCloseTo(40, 5);
  });
});

describe("buildEmployerW4Recommendations", () => {
  it("keeps recommendations employer-specific", () => {
    const rows = [
      { streamId: "e1", company: "Hospital A", remainingPaychecks: 10, currentExtraW4PerPaycheck: 200 },
      { streamId: "e2", company: "Hospital B", remainingPaychecks: 6, currentExtraW4PerPaycheck: 0 },
    ];
    const recs = buildEmployerW4Recommendations(rows, [
      { streamId: "e1", step4cPerPaycheck: 250 },
      { streamId: "e2", step4cPerPaycheck: 120 },
    ]);
    const a = recs.find((r) => r.row.streamId === "e1")!;
    const b = recs.find((r) => r.row.streamId === "e2")!;
    expect(a.change.recommendedExtraPerPaycheck).toBe(250);
    expect(a.change.direction).toBe("increase");
    expect(a.annualRecommendedExtra).toBe(2500);
    expect(b.change.currentExtraPerPaycheck).toBe(0);
    expect(b.change.recommendedExtraPerPaycheck).toBe(120);
  });

  it("one employer's current amount never changes another's target", () => {
    const allocations = [
      { streamId: "e1", step4cPerPaycheck: 400 },
      { streamId: "e2", step4cPerPaycheck: 300 },
    ];
    const base = buildEmployerW4Recommendations(
      [
        { streamId: "e1", company: "A", remainingPaychecks: 10, currentExtraW4PerPaycheck: 0 },
        { streamId: "e2", company: "B", remainingPaychecks: 10, currentExtraW4PerPaycheck: 0 },
      ],
      allocations,
    );
    const afterEdit = buildEmployerW4Recommendations(
      [
        { streamId: "e1", company: "A", remainingPaychecks: 10, currentExtraW4PerPaycheck: 400 },
        { streamId: "e2", company: "B", remainingPaychecks: 10, currentExtraW4PerPaycheck: 0 },
      ],
      allocations,
    );
    expect(afterEdit[0].change.direction).toBe("none");
    expect(afterEdit[1].change.recommendedExtraPerPaycheck).toBe(
      base[1].change.recommendedExtraPerPaycheck,
    );
  });
});
