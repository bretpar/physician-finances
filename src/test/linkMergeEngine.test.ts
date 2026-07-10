import { describe, expect, it } from "vitest";
import {
  applyResolutions,
  computeFieldConflicts,
  defaultResolutions,
  hasLargeAmountDiff,
} from "@/lib/linkMergeEngine";

describe("linkMergeEngine", () => {
  it("skips fields that are identical on both sides", () => {
    const conflicts = computeFieldConflicts({
      current:  { deposited_amount: 7330, transaction_date: "2025-07-01", vendor: "Same" },
      imported: { deposited_amount: 7330, transaction_date: "2025-07-01", vendor: "Same" },
    });
    expect(conflicts).toEqual([]);
  });

  it("auto-merges when only one side has a value (no conflict surfaced)", () => {
    const conflicts = computeFieldConflicts({
      current:  { gross_amount: 10000, deposited_amount: null, vendor: "Payor" },
      imported: { deposited_amount: 7280, vendor: null },
    });
    expect(conflicts.map((c) => c.key)).toEqual([]);
  });

  it("surfaces a money conflict when both sides differ on Net Received", () => {
    const conflicts = computeFieldConflicts({
      current:  { deposited_amount: 7330 },
      imported: { deposited_amount: 7280 },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe("deposited_amount");
    expect(conflicts[0].kind).toBe("money");
    expect(conflicts[0].defaultChoice).toBe("imported");
  });

  it("surfaces multiple conflicts and preserves per-field default choice", () => {
    const conflicts = computeFieldConflicts({
      current:  { deposited_amount: 7330, transaction_date: "2025-07-01", vendor: "Moonlighting Shift" },
      imported: { deposited_amount: 7280, transaction_date: "2025-07-02", vendor: "Virginia Mason Payroll" },
    });
    expect(conflicts.map((c) => c.key).sort()).toEqual(
      ["deposited_amount", "transaction_date", "vendor"].sort(),
    );
    const byKey = Object.fromEntries(conflicts.map((c) => [c.key, c.defaultChoice]));
    // Bank owns cash truth; user owns description.
    expect(byKey.deposited_amount).toBe("imported");
    expect(byKey.transaction_date).toBe("imported");
    expect(byKey.vendor).toBe("current");
  });

  it("applyResolutions returns the chosen value per field and writes field locks", () => {
    const input = {
      current:  { deposited_amount: 7330, vendor: "Moonlighting Shift" },
      imported: { deposited_amount: 7280, vendor: "Virginia Mason Payroll" },
    };
    const { appliedValues, fieldLocks } = applyResolutions(input, [
      { key: "deposited_amount", choice: "current" },
      { key: "vendor", choice: "imported" },
    ]);
    expect(appliedValues.deposited_amount).toBe(7330);
    expect(appliedValues.vendor).toBe("Virginia Mason Payroll");
    expect(fieldLocks).toEqual({ deposited_amount: "current", vendor: "imported" });
  });

  it("honors a custom value override", () => {
    const { appliedValues, fieldLocks } = applyResolutions(
      { current: { deposited_amount: 7330 }, imported: { deposited_amount: 7280 } },
      [{ key: "deposited_amount", choice: "custom", customValue: 7305 }],
    );
    expect(appliedValues.deposited_amount).toBe(7305);
    expect(fieldLocks.deposited_amount).toBe("custom");
  });

  it("hasLargeAmountDiff flags >10% swings and ignores empty sides", () => {
    expect(hasLargeAmountDiff(7330, 1410)).toBe(true);
    expect(hasLargeAmountDiff(7330, 7280)).toBe(false);
    expect(hasLargeAmountDiff(0, 1410)).toBe(false);
    expect(hasLargeAmountDiff(7330, null)).toBe(false);
  });

  it("defaultResolutions produces one resolution per conflict with its default choice", () => {
    const conflicts = computeFieldConflicts({
      current:  { deposited_amount: 7330, vendor: "A" },
      imported: { deposited_amount: 7280, vendor: "B" },
    });
    const resolutions = defaultResolutions(conflicts);
    const map = Object.fromEntries(resolutions.map((r) => [r.key, r.choice]));
    expect(map.deposited_amount).toBe("imported");
    expect(map.vendor).toBe("current");
  });
});
