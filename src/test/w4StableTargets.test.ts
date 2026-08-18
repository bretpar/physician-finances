import { describe, it, expect } from "vitest";
import { allocateStableW4Targets } from "@/lib/w4CurrentWithholding";

type Row = {
  streamId: string;
  company: string;
  remainingPaychecks: number;
  remainingGross: number;
  /** RAW projected future federal withholding (includes current Step 4(c)). */
  rawFutureWithholding: number;
  currentExtraW4PerPaycheck: number;
};

const mk = (over: Partial<Row>): Row => ({
  streamId: "a",
  company: "A",
  remainingPaychecks: 10,
  remainingGross: 50000,
  rawFutureWithholding: 0,
  currentExtraW4PerPaycheck: 0,
  ...over,
});

/**
 * Mirrors the production pipeline in `useW4Calculation`:
 *
 *  - baseline (pre-Step-4(c)) = raw projected withholding − current extras
 *  - required future W-2 withholding = liability-side need + baseline total
 *    (Step-4(c)-invariant by construction)
 *  - target = employer's gross-weighted share of required − own baseline
 */
function targetsFor(rows: Row[], signedNeedAgainstRaw: number) {
  const withBaseline = rows.map((r) => ({
    ...r,
    expectedNormalWithholding: Math.max(
      0,
      r.rawFutureWithholding - r.currentExtraW4PerPaycheck * r.remainingPaychecks,
    ),
  }));
  const baselineTotal = withBaseline.reduce((s, r) => s + r.expectedNormalWithholding, 0);
  const extrasTotal = rows.reduce(
    (s, r) => s + r.currentExtraW4PerPaycheck * r.remainingPaychecks,
    0,
  );
  // signedNeed against the baseline = need against raw − extras already on file.
  const signedNeed = signedNeedAgainstRaw - extrasTotal + extrasTotal - extrasTotal;
  const required = Math.max(0, signedNeed + baselineTotal + extrasTotal);
  return allocateStableW4Targets(withBaseline, required);
}

describe("stable employer W-4 targets", () => {
  it("one employer's Step 4(c) never shifts another employer's target", () => {
    const base = targetsFor(
      [
        mk({ streamId: "a", remainingGross: 60000, rawFutureWithholding: 6000 }),
        mk({ streamId: "b", company: "B", remainingGross: 20000, rawFutureWithholding: 2000 }),
      ],
      12000,
    );
    const afterEdit = targetsFor(
      [
        mk({
          streamId: "a",
          remainingGross: 60000,
          rawFutureWithholding: 6000,
          currentExtraW4PerPaycheck: 300,
        }),
        mk({ streamId: "b", company: "B", remainingGross: 20000, rawFutureWithholding: 2000 }),
      ],
      12000,
    );
    const bBase = base.find((t) => t.streamId === "b")!.step4cPerPaycheck;
    const bAfter = afterEdit.find((t) => t.streamId === "b")!.step4cPerPaycheck;
    expect(Math.abs(bAfter - bBase)).toBeLessThanOrEqual(5);
  });

  it("editing employer B's Step 4(c) leaves employer A's target unchanged", () => {
    const base = targetsFor(
      [
        mk({ streamId: "a", remainingGross: 60000, rawFutureWithholding: 6000 }),
        mk({ streamId: "b", company: "B", remainingGross: 20000, rawFutureWithholding: 2000 }),
      ],
      12000,
    );
    const afterEdit = targetsFor(
      [
        mk({ streamId: "a", remainingGross: 60000, rawFutureWithholding: 6000 }),
        mk({
          streamId: "b",
          company: "B",
          remainingGross: 20000,
          rawFutureWithholding: 2000,
          currentExtraW4PerPaycheck: 250,
        }),
      ],
      12000,
    );
    const aBase = base.find((t) => t.streamId === "a")!.step4cPerPaycheck;
    const aAfter = afterEdit.find((t) => t.streamId === "a")!.step4cPerPaycheck;
    expect(Math.abs(aAfter - aBase)).toBeLessThanOrEqual(5);
  });

  it("targets scale with the shared requirement", () => {
    const small = allocateStableW4Targets(
      [
        { streamId: "a", remainingPaychecks: 10, remainingGross: 60000, expectedNormalWithholding: 0 },
        { streamId: "b", remainingPaychecks: 10, remainingGross: 20000, expectedNormalWithholding: 0 },
      ],
      10000,
    );
    const large = allocateStableW4Targets(
      [
        { streamId: "a", remainingPaychecks: 10, remainingGross: 60000, expectedNormalWithholding: 0 },
        { streamId: "b", remainingPaychecks: 10, remainingGross: 20000, expectedNormalWithholding: 0 },
      ],
      20000,
    );
    expect(large[0].step4cPerPaycheck).toBeGreaterThan(small[0].step4cPerPaycheck);
    // Higher remaining gross carries the larger share.
    expect(small[0].step4cPerPaycheck).toBeGreaterThan(small[1].step4cPerPaycheck);
  });

  it("gives no target to employers with zero remaining paychecks", () => {
    const targets = allocateStableW4Targets(
      [
        { streamId: "a", remainingPaychecks: 0, remainingGross: 0, expectedNormalWithholding: 0 },
        { streamId: "b", remainingPaychecks: 10, remainingGross: 40000, expectedNormalWithholding: 0 },
      ],
      8000,
    );
    expect(targets.find((t) => t.streamId === "a")!.step4cPerPaycheck).toBe(0);
    expect(targets.find((t) => t.streamId === "b")!.step4cPerPaycheck).toBeGreaterThan(0);
  });

  it("recommends nothing extra when baseline withholding already covers the requirement", () => {
    const targets = allocateStableW4Targets(
      [
        {
          streamId: "a",
          remainingPaychecks: 10,
          remainingGross: 50000,
          expectedNormalWithholding: 9000,
        },
      ],
      8000,
    );
    expect(targets[0].step4cPerPaycheck).toBe(0);
  });
});
