/**
 * YTD Catch-Up ledger rendering — deterministic invariants.
 *
 * Guards the canonical model:
 *   • Each ytd_catchup_entries row produces at MOST one mirror in any
 *     given ledger (personal or business). Duplicate mirrors are an
 *     impossible semantic state.
 *   • The mirror row's withholding/income contribution to the ledger
 *     totals matches what the tax engine consumes from the canonical
 *     catch-up entry (mirrors carry `include_in_tax_estimate=false` so
 *     they do not double-count; the ledger STILL surfaces the figures
 *     for user traceability).
 */

import { describe, it, expect } from "vitest";
import {
  dedupeYtdPersonalMirrors,
  dedupeYtdBusinessMirrors,
  isYtdPersonalMirror,
  isYtdBusinessMirror,
} from "@/lib/ytdCatchupLedger";

type PersonalRow = {
  id: string;
  created_at?: string | null;
  linked_ytd_catchup_id?: string | null;
  gross_amount?: number;
  federal_withholding?: number;
  include_in_tax_estimate?: boolean;
};

type BusinessRow = {
  id: string;
  created_at?: string | null;
  origin_ytd_catchup_id?: string | null;
  origin_type?: string | null;
  transaction_type?: string | null;
  amount?: number;
};


describe("YTD catch-up ledger — dedupe & trace invariants", () => {
  it("renders exactly one personal mirror row per catch-up parent", () => {
    const rows: PersonalRow[] = [
      { id: "p1", linked_ytd_catchup_id: "cu-A", created_at: "2026-01-01T00:00:00Z", gross_amount: 5000 },
      { id: "p2", linked_ytd_catchup_id: "cu-A", created_at: "2026-01-02T00:00:00Z", gross_amount: 5000 },
      { id: "p3", linked_ytd_catchup_id: "cu-B", created_at: "2026-01-01T00:00:00Z", gross_amount: 3000 },
      { id: "p4", linked_ytd_catchup_id: null, created_at: "2026-01-01T00:00:00Z", gross_amount: 100 },
    ];
    const deduped = dedupeYtdPersonalMirrors(rows);
    const parents = deduped
      .map((r) => r.linked_ytd_catchup_id)
      .filter((x): x is string => !!x);
    expect(new Set(parents).size).toBe(parents.length);
    expect(deduped.find((r) => r.linked_ytd_catchup_id === "cu-A")?.id).toBe("p1");
    expect(deduped).toHaveLength(3); // p1 (winner of A), p3, p4
  });

  it("renders exactly one business mirror tx per (catch-up parent, transaction_type)", () => {
    const rows: BusinessRow[] = [
      // two duplicate income mirrors for cu-X — should collapse to one
      { id: "t1", origin_ytd_catchup_id: "cu-X", origin_type: "ytd_catchup", transaction_type: "income", created_at: "2026-02-01T00:00:00Z", amount: 9000 },
      { id: "t2", origin_ytd_catchup_id: "cu-X", origin_type: "ytd_catchup", transaction_type: "income", created_at: "2026-02-02T00:00:00Z", amount: 9000 },
      { id: "t3", origin_ytd_catchup_id: null, transaction_type: "expense", created_at: "2026-02-01T00:00:00Z", amount: 50 },
    ];
    const deduped = dedupeYtdBusinessMirrors(rows);
    expect(deduped.find((r) => r.origin_ytd_catchup_id === "cu-X")?.id).toBe("t1");
    expect(deduped).toHaveLength(2);
  });

  it("keeps BOTH income and expense mirrors for the same business catch-up parent", () => {
    // Regression: previously dedupe collapsed by parent only, hiding the
    // YTD business expense mirror from Business Activity even though the
    // canonical row existed in the database.
    const rows: BusinessRow[] = [
      { id: "tx-income", origin_ytd_catchup_id: "cu-Y", origin_type: "ytd_catchup", transaction_type: "income", created_at: "2026-03-01T00:00:00Z", amount: 75000 },
      { id: "tx-expense", origin_ytd_catchup_id: "cu-Y", origin_type: "ytd_catchup", transaction_type: "expense", created_at: "2026-03-01T00:00:01Z", amount: 5000 },
    ];
    const deduped = dedupeYtdBusinessMirrors(rows);
    const ids = deduped.map((r) => r.id).sort();
    expect(ids).toEqual(["tx-expense", "tx-income"]);
    const expenseTotal = deduped
      .filter((r) => r.transaction_type === "expense")
      .reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
    expect(expenseTotal).toBe(5000);
  });


  it("ledger gross total for YTD mirrors equals canonical catch-up gross (no double-counting)", () => {
    // Simulated state: two replicated mirror rows for cu-A from a sync retry.
    const rows: PersonalRow[] = [
      { id: "p1", linked_ytd_catchup_id: "cu-A", created_at: "t1", gross_amount: 5000, federal_withholding: 600 },
      { id: "p2-dupe", linked_ytd_catchup_id: "cu-A", created_at: "t2", gross_amount: 5000, federal_withholding: 600 },
    ];
    const canonicalCatchupGross = 5000; // from ytd_catchup_entries
    const ledgerGross = dedupeYtdPersonalMirrors(rows).reduce(
      (s, r) => s + (Number(r.gross_amount) || 0),
      0,
    );
    expect(ledgerGross).toBe(canonicalCatchupGross);
  });

  it("ledger business mirror amount equals canonical catch-up gross", () => {
    const rows: BusinessRow[] = [
      { id: "t1", origin_ytd_catchup_id: "cu-X", origin_type: "ytd_catchup", created_at: "t1", amount: 9000 },
      { id: "t2-dupe", origin_ytd_catchup_id: "cu-X", origin_type: "ytd_catchup", created_at: "t2", amount: 9000 },
    ];
    const canonicalCatchupGross = 9000;
    const ledgerTotal = dedupeYtdBusinessMirrors(rows).reduce(
      (s, r) => s + Math.abs(Number(r.amount) || 0),
      0,
    );
    expect(ledgerTotal).toBe(canonicalCatchupGross);
  });

  it("isYtdPersonalMirror / isYtdBusinessMirror flag exactly the mirror rows", () => {
    expect(isYtdPersonalMirror({ id: "x", linked_ytd_catchup_id: "cu-A" })).toBe(true);
    expect(isYtdPersonalMirror({ id: "x", linked_ytd_catchup_id: null })).toBe(false);
    expect(isYtdBusinessMirror({ id: "x", origin_type: "ytd_catchup" })).toBe(true);
    expect(isYtdBusinessMirror({ id: "x", origin_ytd_catchup_id: "cu-X" })).toBe(true);
    expect(isYtdBusinessMirror({ id: "x", origin_type: "manual" })).toBe(false);
  });

  it("preserves original ordering of surviving rows", () => {
    const rows: PersonalRow[] = [
      { id: "a", linked_ytd_catchup_id: null, created_at: "t0" },
      { id: "b1", linked_ytd_catchup_id: "cu-A", created_at: "t1" },
      { id: "c", linked_ytd_catchup_id: null, created_at: "t2" },
      { id: "b2", linked_ytd_catchup_id: "cu-A", created_at: "t3" },
    ];
    const order = dedupeYtdPersonalMirrors(rows).map((r) => r.id);
    expect(order).toEqual(["a", "b1", "c"]);
  });

  it("passes through empty input", () => {
    expect(dedupeYtdPersonalMirrors([])).toEqual([]);
    expect(dedupeYtdBusinessMirrors([])).toEqual([]);
  });
});
