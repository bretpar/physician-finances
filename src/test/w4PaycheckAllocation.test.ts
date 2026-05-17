import { describe, it, expect } from "vitest";
import { computeAllocations, type EmployerRow } from "@/components/tax/W4PaycheckAdjustmentCard";

const mkRow = (over: Partial<EmployerRow> = {}): EmployerRow => ({
  streamId: "s1",
  company: "Acme",
  payFrequency: "biweekly",
  remainingPaychecks: 10,
  remainingGross: 50000,
  expectedNormalWithholding: 0,
  ...over,
});

describe("computeAllocations", () => {
  it("returns empty when no employer rows", () => {
    expect(computeAllocations([], 1000, 0)).toEqual([]);
  });

  it("returns zero allocations when gap <= 0", () => {
    const rows = [mkRow()];
    const result = computeAllocations(rows, 0, 50000);
    expect(result[0].step4cPerPaycheck).toBe(0);
  });

  it("does not loop forever with awkward diff (e.g. 3)", () => {
    const rows = [mkRow({ remainingPaychecks: 1, remainingGross: 100 })];
    // diff that can't be resolved in $5 increments
    const start = Date.now();
    const result = computeAllocations(rows, 3, 100);
    expect(Date.now() - start).toBeLessThan(100);
    expect(result).toHaveLength(1);
    expect(result[0].step4cPerPaycheck).toBeGreaterThanOrEqual(0);
  });

  it("rounds to nearest $5", () => {
    const rows = [mkRow({ remainingPaychecks: 10 })];
    const result = computeAllocations(rows, 123, 50000);
    expect(result[0].step4cPerPaycheck % 5).toBe(0);
  });

  it("allocates proportionally across multiple employers", () => {
    const rows = [
      mkRow({ streamId: "a", remainingGross: 30000, remainingPaychecks: 10 }),
      mkRow({ streamId: "b", remainingGross: 10000, remainingPaychecks: 10 }),
    ];
    const result = computeAllocations(rows, 4000, 40000);
    expect(result).toHaveLength(2);
    expect(result[0].step4cPerPaycheck).toBeGreaterThan(result[1].step4cPerPaycheck);
  });
});
