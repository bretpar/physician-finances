import { describe, it, expect } from "vitest";
import { formatMergeSummary, COMPANY_REFERENCE_COLUMNS } from "@/lib/mergeCompanies";
import {
  employerKeyForStream,
  groupW2StreamsByEmployer,
  type GroupedStreamInput,
} from "@/components/tax/W4PaycheckAdjustmentCard";

describe("formatMergeSummary", () => {
  it("summarizes counts in human form", () => {
    const msg = formatMergeSummary(
      {
        projected_income_streams: 3,
        income_entries: 12,
        transactions: 5,
        home_office_deductions: 0,
        hsa_contributions: 0,
        mileage_entries: 1,
      },
      "Optum",
      2,
    );
    expect(msg).toContain("3 income streams");
    expect(msg).toContain("12 income entries");
    expect(msg).toContain("5 transactions");
    expect(msg).toContain("1 mileage entry");
    expect(msg).toContain("2 duplicate records");
    expect(msg).toContain("Optum");
  });

  it("falls back when there are no linked rows", () => {
    const msg = formatMergeSummary({}, "Optum", 1);
    expect(msg).toContain("No linked records");
    expect(msg).toContain("Optum");
  });
});

describe("merge + W-4 integration", () => {
  it("after merging 3 Optum company records into one, W-4 shows ONE row", () => {
    // Simulate the post-merge state: all 3 projected streams now point at
    // the same primary source_id. The W-4 grouper must collapse them.
    const PRIMARY = "src-primary";
    const streams: GroupedStreamInput[] = [
      {
        id: "s1", company: "Optum", company_type: "w2",
        pay_frequency: "biweekly", source_id: PRIMARY,
        updated_at: "2026-01-01", is_active: true,
      },
      {
        id: "s2", company: "Optum", company_type: "w2",
        pay_frequency: "biweekly", source_id: PRIMARY,
        updated_at: "2026-02-01", is_active: true,
      },
      {
        id: "s3", company: "Optum", company_type: "w2",
        pay_frequency: "biweekly", source_id: PRIMARY,
        updated_at: "2026-03-01", is_active: true,
      },
    ];
    const dates = new Map([
      ["s1", new Set(["2026-06-15"])],
      ["s2", new Set(["2026-06-30"])],
      ["s3", new Set(["2026-07-15"])],
    ]);
    const groups = groupW2StreamsByEmployer(streams, dates);
    expect(groups).toHaveLength(1);
    expect(groups[0].uniqueSourceIds).toEqual([PRIMARY]);
  });
});

describe("COMPANY_REFERENCE_COLUMNS", () => {
  it("covers the expected company-linked tables", () => {
    const tables = COMPANY_REFERENCE_COLUMNS.map(([t]) => t);
    expect(tables).toContain("projected_income_streams");
    expect(tables).toContain("income_entries");
    expect(tables).toContain("transactions");
  });
});

describe("archived company filtering (employerKeyForStream)", () => {
  it("still keys by canonical name (merge target absorbs duplicates)", () => {
    // Even before the merge runs, the grouper already canonicalizes —
    // post-merge this just becomes redundant safety.
    const a = employerKeyForStream({ source_id: "src-1", company: "Optum", company_type: "w2" });
    const b = employerKeyForStream({ source_id: "src-2", company: "OPTUM", company_type: "w2" });
    expect(a).toBe(b);
  });
});
