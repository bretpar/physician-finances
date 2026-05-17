import { describe, it, expect } from "vitest";
import {
  employerKeyForStream,
  groupW2StreamsByEmployer,
  detectFrequencyFromDates,
  type GroupedStreamInput,
} from "@/components/tax/W4PaycheckAdjustmentCard";

const mkStream = (over: Partial<GroupedStreamInput> = {}): GroupedStreamInput => ({
  id: "s1",
  company: "Acme",
  company_type: "w2",
  pay_frequency: "biweekly",
  source_id: null,
  updated_at: "2026-01-01T00:00:00Z",
  is_active: true,
  ...over,
});

describe("employerKeyForStream", () => {
  it("prefers source_id when present", () => {
    expect(employerKeyForStream({ source_id: "abc", company: "X" })).toBe("src:abc");
  });
  it("falls back to normalized company name + company_type", () => {
    expect(employerKeyForStream({ source_id: null, company: "  Acme   Health ", company_type: "W2" }))
      .toBe(employerKeyForStream({ source_id: null, company: "acme health", company_type: "w2" }));
  });
});

describe("groupW2StreamsByEmployer", () => {
  it("collapses two streams with same source_id and overlapping pay dates", () => {
    const s1 = mkStream({ id: "a", source_id: "src1", updated_at: "2026-01-01" });
    const s2 = mkStream({ id: "b", source_id: "src1", updated_at: "2026-05-01" });
    const dates = new Map([
      ["a", new Set(["2026-06-15", "2026-06-30"])],
      ["b", new Set(["2026-06-15", "2026-06-30"])],
    ]);
    const groups = groupW2StreamsByEmployer([s1, s2], dates);
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryStreamId).toBe("b"); // newer updated_at wins
    expect(groups[0].includedStreamIds).toEqual(["b"]);
    expect(groups[0].droppedStreamIds).toEqual(["a"]);
  });

  it("produces two rows for two different employers", () => {
    const s1 = mkStream({ id: "a", source_id: "src1", company: "Acme" });
    const s2 = mkStream({ id: "b", source_id: "src2", company: "Globex" });
    const dates = new Map([
      ["a", new Set(["2026-06-15"])],
      ["b", new Set(["2026-06-20"])],
    ]);
    const groups = groupW2StreamsByEmployer([s1, s2], dates);
    expect(groups).toHaveLength(2);
  });

  it("keeps both streams when same employer has truly distinct schedules (no overlap)", () => {
    const s1 = mkStream({ id: "a", source_id: "src1", updated_at: "2026-05-01" });
    const s2 = mkStream({ id: "b", source_id: "src1", updated_at: "2026-01-01" });
    const dates = new Map([
      ["a", new Set(["2026-06-15", "2026-06-30"])],
      ["b", new Set(["2026-07-07", "2026-07-21"])], // no overlap
    ]);
    const groups = groupW2StreamsByEmployer([s1, s2], dates);
    expect(groups).toHaveLength(1);
    expect(groups[0].includedStreamIds.sort()).toEqual(["a", "b"]);
    expect(groups[0].droppedStreamIds).toEqual([]);
  });

  it("does not double-count identical pay dates across duplicate schedules", () => {
    const s1 = mkStream({ id: "a", source_id: "src1", updated_at: "2026-05-01" });
    const s2 = mkStream({ id: "b", source_id: "src1", updated_at: "2026-01-01" });
    const dates = new Map([
      ["a", new Set(["2026-06-15", "2026-06-30", "2026-07-15"])],
      ["b", new Set(["2026-06-15", "2026-06-30", "2026-07-15"])],
    ]);
    const groups = groupW2StreamsByEmployer([s1, s2], dates);
    expect(groups[0].includedStreamIds).toEqual(["a"]);
    expect(groups[0].droppedStreamIds).toEqual(["b"]);
  });
});

describe("detectFrequencyFromDates", () => {
  it("detects monthly cadence from real ledger dates (does not default to biweekly)", () => {
    const dates = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"];
    const { frequency } = detectFrequencyFromDates(dates);
    expect(frequency).toBe("monthly");
  });

  it("detects weekly cadence", () => {
    const dates = ["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23"];
    const { frequency } = detectFrequencyFromDates(dates);
    expect(frequency).toBe("weekly");
  });
});
