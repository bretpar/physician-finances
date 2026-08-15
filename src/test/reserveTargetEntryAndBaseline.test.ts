/**
 * Production QA regressions (Aug 2026), two root causes:
 *
 * Fix 1 — the Business Activity reserve-confirm flow wrote the reserve to
 *   `incomeEntries[0]` (newest cached row = a W-2 paycheck) instead of the 1099
 *   entry that generated the recommendation.
 * Fix 2 — `deriveBaselineQuarterTarget` counted the BRAND-NEW recommendation
 *   (created by the very income event that raised the target) as unsatisfied
 *   history, making `estimate_increased` unreachable.
 */
import { describe, it, expect } from "vitest";
import {
  resolveReserveTargetEntry,
  nextReserveAmount,
} from "@/lib/reserveTargetEntry";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";
import {
  deriveBaselineQuarterTarget,
  computeCatchUpRecommendation,
} from "@/lib/catchUpRecommendation";

const NOW = new Date(2026, 7, 15); // Q3 2026
const YEAR = 2026;
const Q = 3 as const;

/** 3 W-2 paychecks: $900 federal income tax paid, $979 reserved (Saved). */
const w2Entries = () => [
  { id: "w2-3", company: "Clinic W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-08-14", gross_amount: 10000, federal_withholding: 300, additional_tax_reserve: 379, dynamic_tax_recommendation: 379 },
  { id: "w2-2", company: "Clinic W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-07-31", gross_amount: 10000, federal_withholding: 300, additional_tax_reserve: 300, dynamic_tax_recommendation: 300 },
  { id: "w2-1", company: "Clinic W2", source_id: "emp-1", source_bucket: "personal", income_type: "w2", income_date: "2026-07-15", gross_amount: 10000, federal_withholding: 300, additional_tax_reserve: 300, dynamic_tax_recommendation: 300 },
];

const entry1099 = (over: Record<string, unknown> = {}) => ({
  id: "e1099",
  company: "Locums LLC",
  source_id: "biz-1",
  source_bucket: "personal",
  income_type: "1099",
  income_date: "2026-08-15",
  gross_amount: 10000,
  federal_withholding: 0,
  additional_tax_reserve: 0,
  dynamic_tax_recommendation: 2305,
  linked_transaction_id: null,
  ...over,
});

// ── Fix 1 ────────────────────────────────────────────────────────────────────
describe("Fix 1 — reserve lands on the entry that owns the recommendation", () => {
  it("updates the 1099 entry, not incomeEntries[0]", () => {
    // Newest-first cached list: the W-2 paycheck happens to be first.
    const cached = [
      { id: "w2-3", additional_tax_reserve: 379 },
      entry1099(),
    ];
    const target = resolveReserveTargetEntry(cached as any[], "e1099");
    expect(target?.id).toBe("e1099");
    expect(nextReserveAmount(target?.additional_tax_reserve, 2305)).toBe(2305);
  });

  it("a newer W-2 row can never absorb a 1099 reserve", () => {
    const cached = [
      { id: "w2-newest", additional_tax_reserve: 379 },
      { id: "w2-older", additional_tax_reserve: 300 },
      entry1099(),
    ];
    const target = resolveReserveTargetEntry(cached as any[], "e1099");
    expect(target?.id).not.toBe("w2-newest");
    // W-2 rows are untouched by the resolution.
    expect(cached[0].additional_tax_reserve).toBe(379);
  });

  it("returns null rather than guessing when the owning entry is missing", () => {
    expect(resolveReserveTargetEntry([{ id: "w2-newest" }] as any[], "e1099")).toBeNull();
  });

  it("keeps the legacy newest-row fallback only when no id was captured", () => {
    const cached = [{ id: "legacy-newest" }, { id: "older" }];
    expect(resolveReserveTargetEntry(cached as any[], null)?.id).toBe("legacy-newest");
    expect(resolveReserveTargetEntry([], null)).toBeNull();
  });

  it("adds to an existing reserve on the same row (no clobber, no double count)", () => {
    expect(nextReserveAmount(979, 2305)).toBe(3284);
    expect(nextReserveAmount(null, 2305)).toBe(2305);
    expect(nextReserveAmount(100, -50)).toBe(100);
  });
});

// ── Production scenario end state ────────────────────────────────────────────
describe("production scenario — source rows after the reserve is saved correctly", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    annualTaxLiability: 4000 * 4,
    year: YEAR,
    quarter: Q,
    quarterMethod: "even" as const,
    now: NOW,
    personalEntries: w2Entries(),
    incomeEntries: [] as any[],
    transactions: [] as any[],
    ...over,
  });

  it("W-2 Saved stays $979 and the 1099 reserve shows under the 1099 source", () => {
    const rec = buildQuarterRecommendation(
      input({ incomeEntries: [entry1099({ additional_tax_reserve: 2305 })] }),
    );
    const w2Row = rec.sourceRows.find((r) => r.label.includes("Clinic W2"));
    const bizRow = rec.sourceRows.find((r) => r.label.includes("Locums"));
    expect(w2Row?.saved).toBeCloseTo(979, 2);
    expect(bizRow?.saved).toBeCloseTo(2305, 2);
    expect(rec.savedThisQuarter).toBeCloseTo(3284, 2);
    // Headline Saved equals the sum of the source rows' Saved.
    expect(rec.sourceRows.reduce((s, r) => s + r.saved, 0)).toBeCloseTo(
      rec.savedThisQuarter,
      2,
    );
    // Paid is unchanged by reserves (Saved → Paid behavior untouched).
    expect(rec.paidThisQuarter).toBeCloseTo(900, 2);
  });

  it("without the fix's data (reserve on the W-2 row) the 1099 row has no Saved", () => {
    // Documents the broken production state so a regression is obvious.
    const broken = buildQuarterRecommendation(
      input({
        personalEntries: w2Entries().map((e, i) =>
          i === 0 ? { ...e, additional_tax_reserve: 379 + 2305 } : e,
        ),
        incomeEntries: [entry1099()],
      }),
    );
    const bizRow = broken.sourceRows.find((r) => r.label.includes("Locums"));
    expect(bizRow?.saved ?? 0).toBe(0);
  });
});

// ── Fix 2 ────────────────────────────────────────────────────────────────────
describe("Fix 2 — the triggering recommendation is excluded from the baseline", () => {
  const priorRows = [
    { id: "w2-1", recommended: 300, satisfied: 300 },
    { id: "w2-2", recommended: 300, satisfied: 300 },
    { id: "w2-3", recommended: 379, satisfied: 379 },
  ];

  it("brand-new unsatisfied recommendation no longer zeroes the baseline", () => {
    const rows = [...priorRows, { id: "e1099", recommended: 2305, satisfied: 0 }];
    expect(deriveBaselineQuarterTarget(rows, 1879)).toBe(0);
    expect(deriveBaselineQuarterTarget(rows, 1879, ["e1099"])).toBe(1879);
  });

  it("genuine earlier noncompliance still yields no baseline", () => {
    const rows = [
      { id: "w2-1", recommended: 300, satisfied: 0 },
      { id: "e1099", recommended: 2305, satisfied: 0 },
    ];
    expect(deriveBaselineQuarterTarget(rows, 1879, ["e1099"])).toBe(0);
  });

  it("fully compliant history + new liability → estimate_increased", () => {
    const baseline = deriveBaselineQuarterTarget(
      [...priorRows, { id: "e1099", recommended: 2305, satisfied: 0 }],
      1879,
      ["e1099"],
    );
    const status = computeCatchUpRecommendation({
      quarterTarget: 4184,
      coveredSoFar: 1879,
      remainingOpportunities: 3,
      baselineQuarterTarget: baseline,
    });
    expect(status.recommendationStatus).toBe("estimate_increased");
    expect(status.statusHeadline).toBe("On plan — estimate increased");
  });

  it("earlier unsatisfied recommendation → catch_up_needed language", () => {
    const baseline = deriveBaselineQuarterTarget(
      [{ id: "w2-1", recommended: 300, satisfied: 0 }, { id: "e1099", recommended: 2305, satisfied: 0 }],
      1879,
      ["e1099"],
    );
    const status = computeCatchUpRecommendation({
      quarterTarget: 4184,
      coveredSoFar: 1879,
      remainingOpportunities: 3,
      baselineQuarterTarget: baseline,
    });
    expect(status.recommendationStatus).toBe("catch_up_needed");
    expect(status.statusHeadline).toBe("Additional catch-up needed");
  });

  it("saving the new recommendation resolves the catch-up", () => {
    const status = computeCatchUpRecommendation({
      quarterTarget: 4184,
      coveredSoFar: 4184,
      remainingOpportunities: 3,
      baselineQuarterTarget: 1879,
    });
    expect(status.totalShortfallByDeadline).toBe(0);
    expect(status.quarterlyAdjustmentAmount).toBe(0);
    expect(["on_track", "ahead"]).toContain(status.recommendationStatus);
  });

  it("buildQuarterRecommendation honors excludeRecommendationEntryIds", () => {
    const input = {
      annualTaxLiability: 4184 * 4,
      year: YEAR,
      quarter: Q,
      quarterMethod: "even" as const,
      now: NOW,
      personalEntries: w2Entries(),
      incomeEntries: [entry1099()],
      transactions: [] as any[],
    };
    const without = buildQuarterRecommendation(input);
    const with_ = buildQuarterRecommendation({
      ...input,
      excludeRecommendationEntryIds: ["e1099"],
    });
    expect(without.baselineQuarterTarget).toBe(0);
    expect(with_.baselineQuarterTarget).toBeGreaterThan(0);
    // Dollar math is untouched by the exclusion.
    expect(with_.quarterTarget).toBeCloseTo(without.quarterTarget, 2);
    expect(with_.savedThisQuarter).toBeCloseTo(without.savedThisQuarter, 2);
    expect(with_.paidThisQuarter).toBeCloseTo(without.paidThisQuarter, 2);
  });
});
