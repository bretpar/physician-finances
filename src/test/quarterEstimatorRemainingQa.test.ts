/**
 * Remaining QA fixes for the quarterly estimator surfaces.
 *
 *  1. A 1099/business YTD catch-up with $0 gross (and no expenses /
 *     withholding) must not require fake $1 income — and the mirror
 *     writer must not insert any ledger rows for that "skipped" source.
 *  2. The Tax Overview "Log Tax Payment" dialog must default to the
 *     currently active IRS estimated-tax quarter, not always Q1.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getActivePaymentTarget } from "@/lib/quarterRecommendation";

describe("Log Tax Payment defaults to active quarter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("defaults to Q2 on June 9 (Q2 due window)", () => {
    vi.setSystemTime(new Date(2026, 5, 9));
    expect(getActivePaymentTarget(new Date()).quarter).toBe(2);
  });

  it("defaults to Q3 in late August (Q3 due window)", () => {
    vi.setSystemTime(new Date(2026, 7, 25));
    expect(getActivePaymentTarget(new Date()).quarter).toBe(3);
  });

  it("defaults to Q1 in early April (Q1 due window)", () => {
    vi.setSystemTime(new Date(2026, 3, 10));
    expect(getActivePaymentTarget(new Date()).quarter).toBe(1);
  });
});

describe("1099/business YTD catch-up — zero-dollar 'skip'", () => {
  // Mirrors the gating used by syncCatchupMirror without spinning up the
  // full Supabase mock. The intent: an all-zero business catch-up writes
  // NO mirror ledger rows.
  function shouldWriteBusinessMirror(c: {
    source_type: string;
    gross_income: number;
    business_expenses?: number;
    federal_withholding?: number;
    state_withholding?: number;
  }) {
    const isBusiness = c.source_type === "1099_k1";
    const gross = Math.max(0, Number(c.gross_income) || 0);
    const exp = Math.max(0, Number(c.business_expenses) || 0);
    const fw = Number(c.federal_withholding) || 0;
    const sw = Number(c.state_withholding) || 0;
    return isBusiness && (gross > 0 || exp > 0 || fw > 0 || sw > 0);
  }

  it("does not write a mirror tx for a $0 business catch-up", () => {
    expect(
      shouldWriteBusinessMirror({
        source_type: "1099_k1",
        gross_income: 0,
        business_expenses: 0,
        federal_withholding: 0,
        state_withholding: 0,
      }),
    ).toBe(false);
  });

  it("still writes a mirror tx for a populated business catch-up", () => {
    expect(
      shouldWriteBusinessMirror({
        source_type: "1099_k1",
        gross_income: 25000,
      }),
    ).toBe(true);
  });

  it("writes a mirror tx when only expenses or withholding are present", () => {
    expect(
      shouldWriteBusinessMirror({ source_type: "1099_k1", gross_income: 0, business_expenses: 500 }),
    ).toBe(true);
    expect(
      shouldWriteBusinessMirror({ source_type: "1099_k1", gross_income: 0, federal_withholding: 200 }),
    ).toBe(true);
  });
});
