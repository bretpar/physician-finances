import { describe, it, expect } from "vitest";
import { computeAllocations } from "@/components/tax/W4PaycheckAdjustmentCard";
import {
  stabilizeW4Targets,
  allocateW4SurplusReduction,
} from "@/lib/w4CurrentWithholding";

type Row = {
  streamId: string;
  company: string;
  payFrequency: string;
  remainingPaychecks: number;
  remainingGross: number;
  expectedNormalWithholding: number;
  currentExtraW4PerPaycheck: number;
};

const mk = (over: Partial<Row>): Row => ({
  streamId: "a",
  company: "A",
  payFrequency: "biweekly",
  remainingPaychecks: 10,
  remainingGross: 50000,
  expectedNormalWithholding: 0,
  currentExtraW4PerPaycheck: 0,
  ...over,
});

/**
 * Mirrors the production allocation pipeline. `need` is the extra-invariant
 * shortfall (annual liability − credits − RAW projected withholding); in
 * production `grossW4Gap` = need + current extras, because the baseline strips
 * the extras out of the raw projection.
 */
function targetsFor(rows: Row[], need: number) {
  const extraTotal = rows.reduce(
    (s, r) => s + r.currentExtraW4PerPaycheck * r.remainingPaychecks,
    0,
  );
  const grossGap = need + extraTotal;
  const totalGross = rows.reduce((s, r) => s + r.remainingGross, 0);
  const incremental = computeAllocations(
    rows as any,
    Math.max(0, grossGap - extraTotal),
    totalGross,
  );
  const reductions = allocateW4SurplusReduction(
    rows.map((r) => ({
      key: r.streamId,
      currentExtraPerPaycheck: r.currentExtraW4PerPaycheck,
      remainingPaychecks: r.remainingPaychecks,
    })),
    Math.max(0, extraTotal - grossGap),
  );
  return stabilizeW4Targets(rows, incremental, reductions);
}

describe("stable employer W-4 targets", () => {
  it("one employer's Step 4(c) never shifts another employer's target", () => {
    const base = targetsFor(
      [
        mk({ streamId: "a", remainingGross: 60000 }),
        mk({ streamId: "b", company: "B", remainingGross: 20000 }),
      ],
      12000,
    );
    const afterEdit = targetsFor(
      [
        mk({ streamId: "a", remainingGross: 60000, currentExtraW4PerPaycheck: 300 }),
        mk({ streamId: "b", company: "B", remainingGross: 20000 }),
      ],
      12000,
    );
    const bBase = base.find((t) => t.streamId === "b")!.step4cPerPaycheck;
    const bAfter = afterEdit.find((t) => t.streamId === "b")!.step4cPerPaycheck;
    expect(bAfter).toBe(bBase);
    // Employer A's own target is unchanged too — the extra just becomes credited.
    const aBase = base.find((t) => t.streamId === "a")!.step4cPerPaycheck;
    const aAfter = afterEdit.find((t) => t.streamId === "a")!.step4cPerPaycheck;
    expect(Math.abs(aAfter - aBase)).toBeLessThanOrEqual(5);
  });

  it("targets cover the gross gap without double-counting current extras", () => {
    const rows = [
      mk({ streamId: "a", remainingGross: 60000, currentExtraW4PerPaycheck: 200 }),
      mk({ streamId: "b", company: "B", remainingGross: 20000 }),
    ];
    const gap = 6000;
    const covered = targetsFor(rows, gap).reduce(
      (s, t) => s + t.step4cPerPaycheck * 10,
      0,
    );
    expect(covered).toBeGreaterThan(gap * 0.9);
    expect(covered).toBeLessThan(gap * 1.15);
  });

  it("recommends a reduction when current extras over-withhold", () => {
    const rows = [mk({ streamId: "a", currentExtraW4PerPaycheck: 100 })];
    // Raw projection already over-covers by $600 → need is negative.
    const targets = targetsFor(rows, -600);
    expect(targets[0].step4cPerPaycheck).toBeLessThan(100);
  });

  it("gives no target to employers with zero remaining paychecks", () => {
    const rows = [
      mk({ streamId: "a", remainingPaychecks: 0, remainingGross: 0, currentExtraW4PerPaycheck: 50 }),
      mk({ streamId: "b", company: "B", remainingGross: 40000 }),
    ];
    const targets = targetsFor(rows, 8000);
    expect(targets.find((t) => t.streamId === "a")!.step4cPerPaycheck).toBe(0);
    expect(targets.find((t) => t.streamId === "b")!.step4cPerPaycheck).toBeGreaterThan(0);
  });
});
