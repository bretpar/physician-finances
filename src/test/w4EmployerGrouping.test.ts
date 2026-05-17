import { describe, it, expect } from "vitest";
import {
  employerKeyForStream,
  groupW2StreamsByEmployer,
  detectFrequencyFromDates,
  normalizeEmployerName,
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

describe("normalizeEmployerName", () => {
  it("lowercases, trims, strips punctuation, and collapses spaces", () => {
    expect(normalizeEmployerName("  Optum, Inc. ")).toBe("optum inc");
    expect(normalizeEmployerName("OPTUM")).toBe("optum");
    expect(normalizeEmployerName(" Optum ")).toBe("optum");
  });
});

describe("employerKeyForStream", () => {
  it("groups by canonical employer name, not source_id", () => {
    const a = employerKeyForStream({ source_id: "src-1", company: "Optum", company_type: "w2" });
    const b = employerKeyForStream({ source_id: "src-2", company: "OPTUM", company_type: "w2" });
    const c = employerKeyForStream({ source_id: "src-3", company: " Optum ", company_type: "w2" });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
  it("buckets w2 and scorp_w2 together", () => {
    expect(employerKeyForStream({ company: "Acme", company_type: "w2" }))
      .toBe(employerKeyForStream({ company: "Acme", company_type: "scorp_w2" }));
  });
  it("separates different employer names", () => {
    expect(employerKeyForStream({ company: "Optum", company_type: "w2" }))
      .not.toBe(employerKeyForStream({ company: "Globex", company_type: "w2" }));
  });
});

describe("groupW2StreamsByEmployer", () => {
  it("collapses three Optum streams with different source_ids into ONE row", () => {
    const s1 = mkStream({ id: "a", company: "Optum", source_id: "src-1" });
    const s2 = mkStream({ id: "b", company: "OPTUM", source_id: "src-2" });
    const s3 = mkStream({ id: "c", company: " Optum ", source_id: "src-3" });
    const dates = new Map([
      ["a", new Set(["2026-06-15"])],
      ["b", new Set(["2026-06-30"])],
      ["c", new Set(["2026-07-15"])],
    ]);
    const groups = groupW2StreamsByEmployer([s1, s2, s3], dates);
    expect(groups).toHaveLength(1);
    expect(groups[0].includedStreamIds.sort()).toEqual(["a", "b", "c"]);
    expect(groups[0].uniqueSourceIds.sort()).toEqual(["src-1", "src-2", "src-3"]);
  });

  it("counts duplicate pay dates across grouped streams as overlaps (not double-counted)", () => {
    const s1 = mkStream({ id: "a", company: "Optum", source_id: "src-1" });
    const s2 = mkStream({ id: "b", company: "Optum", source_id: "src-2" });
    const dates = new Map([
      ["a", new Set(["2026-06-15", "2026-06-30", "2026-07-15"])],
      ["b", new Set(["2026-06-15", "2026-06-30", "2026-07-15"])],
    ]);
    const groups = groupW2StreamsByEmployer([s1, s2], dates);
    expect(groups).toHaveLength(1);
    expect(groups[0].overlapDateCount).toBe(3);
  });

  it("produces separate rows for two truly different employers", () => {
    const s1 = mkStream({ id: "a", company: "Optum", source_id: "src-1" });
    const s2 = mkStream({ id: "b", company: "Globex", source_id: "src-2" });
    const dates = new Map([
      ["a", new Set(["2026-06-15"])],
      ["b", new Set(["2026-06-20"])],
    ]);
    const groups = groupW2StreamsByEmployer([s1, s2], dates);
    expect(groups).toHaveLength(2);
  });
});

describe("detectFrequencyFromDates", () => {
  it("detects monthly cadence from real ledger dates", () => {
    const { frequency } = detectFrequencyFromDates([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
    ]);
    expect(frequency).toBe("monthly");
  });
  it("detects weekly cadence", () => {
    const { frequency } = detectFrequencyFromDates([
      "2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23",
    ]);
    expect(frequency).toBe("weekly");
  });
});
