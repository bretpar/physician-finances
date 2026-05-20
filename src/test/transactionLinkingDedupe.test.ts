import { describe, it, expect } from "vitest";
import { pickCanonicalLinkedRow, type CanonicalCandidate } from "@/hooks/useTransactionMatching";

/**
 * These tests verify the linked-transaction dedupe contract:
 *
 *  - `transactions WHERE status='active'` is the single source of truth for
 *    every total in the app (Business Activity, Dashboard, Tax Overview,
 *    Reports, exports, monthly/quarterly charts).
 *  - When the user links N transactions, exactly one canonical row is kept
 *    active and the others are flipped to status='merged' (hidden from
 *    totals). Selection rule: most-complete tax/accounting fields → manual
 *    or planner over imported → earliest created_at.
 *
 * The selector itself is pure, so we test it directly. The downstream
 * dedupe is then a one-line filter (`t.status === 'active'`) that every
 * existing summary hook already applies; we simulate that filter here to
 * cover the full "what totals see" path.
 */

interface Row extends CanonicalCandidate {
  amount: number;
  transaction_type: "income" | "expense";
  status: "active" | "merged";
}

function applyLinkDedupe(rows: Row[]): Row[] {
  // Pick canonical and mark all others as merged. Mirrors useLinkTransactions.
  const canonical = pickCanonicalLinkedRow(rows);
  return rows.map((r) => (r.id === canonical.id ? { ...r, status: "active" } : { ...r, status: "merged" }));
}

function sumActive(rows: Row[]): number {
  return rows.filter((r) => r.status === "active").reduce((s, r) => s + Math.abs(r.amount), 0);
}

function mkExpense(id: string, source_type: string, created_at: string, extras: Partial<Row> = {}): Row {
  return {
    id,
    amount: 50,
    transaction_type: "expense",
    status: "active",
    source_type,
    created_at,
    category: "Office",
    vendor: "Acme",
    ...extras,
  };
}

describe("Linked transaction dedupe", () => {
  it("Test A: three unlinked $50 expenses total $150", () => {
    const rows: Row[] = [
      mkExpense("a", "manual", "2026-01-01"),
      mkExpense("b", "manual", "2026-01-02"),
      mkExpense("c", "plaid", "2026-01-03"),
    ];
    expect(sumActive(rows)).toBe(150);
  });

  it("Test B: three $50 expenses linked together total $50", () => {
    const rows: Row[] = [
      mkExpense("a", "manual", "2026-01-01"),
      mkExpense("b", "manual", "2026-01-02"),
      mkExpense("c", "manual", "2026-01-03"),
    ];
    const deduped = applyLinkDedupe(rows);
    expect(sumActive(deduped)).toBe(50);
    expect(deduped.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("Test C: manual + imported linked totals $50, manual is canonical", () => {
    const rows: Row[] = [
      mkExpense("plaid-1", "plaid", "2026-01-01"),
      mkExpense("manual-1", "manual", "2026-01-02", { notes: "client lunch", receipt_url: "r" }),
    ];
    const deduped = applyLinkDedupe(rows);
    expect(sumActive(deduped)).toBe(50);
    expect(deduped.find((r) => r.status === "active")?.id).toBe("manual-1");
  });

  it("Test D: manual gross income + imported net deposit — manual wins, gross preserved", () => {
    const rows: Row[] = [
      {
        id: "manual-paycheck",
        amount: 15000,
        transaction_type: "income",
        status: "active",
        source_type: "manual",
        created_at: "2026-01-15",
        category: "Wages",
        vendor: "Hospital",
        notes: "biweekly",
        recommended_withholding: 2500,
        incomeEnrichmentScore: 5, // strong income_entry enrichment
      },
      {
        id: "plaid-deposit",
        amount: 12500,
        transaction_type: "income",
        status: "active",
        source_type: "plaid",
        created_at: "2026-01-16",
        category: "Uncategorized",
        vendor: "DIRECT DEP",
      },
    ];
    const deduped = applyLinkDedupe(rows);
    const active = deduped.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("manual-paycheck");
    // Gross $15,000 preserved; net $12,500 is hidden from totals but the
    // merged row still exists in the DB so the detail card can show it.
    expect(active[0].amount).toBe(15000);
    expect(deduped.find((r) => r.id === "plaid-deposit")?.status).toBe("merged");
    // Total income is gross only, not 15000 + 12500.
    expect(sumActive(deduped)).toBe(15000);
  });

  it("Test E: linked group is counted once across every surface that filters by status='active'", () => {
    const rows: Row[] = [
      mkExpense("a", "manual", "2026-01-01", { amount: 200 }),
      mkExpense("b", "plaid", "2026-01-02", { amount: 200 }),
    ];
    const deduped = applyLinkDedupe(rows);
    // Simulate the filter every consumer applies.
    const businessActivity = deduped.filter((r) => r.status === "active");
    const dashboard = deduped.filter((r) => r.status === "active");
    const taxOverview = deduped.filter((r) => r.status === "active");
    const categoryReport = deduped.filter((r) => r.status === "active");
    const csvExport = deduped.filter((r) => r.status === "active");
    for (const surface of [businessActivity, dashboard, taxOverview, categoryReport, csvExport]) {
      expect(surface).toHaveLength(1);
      expect(surface.reduce((s, r) => s + Math.abs(r.amount), 0)).toBe(200);
    }
  });

  it("imported-only link picks the more complete row", () => {
    const rows: Row[] = [
      mkExpense("plaid-bare", "plaid", "2026-01-01", { category: "Uncategorized", vendor: "" }),
      mkExpense("plaid-rich", "plaid", "2026-01-02", { category: "Office", vendor: "Staples", notes: "ink" }),
    ];
    const deduped = applyLinkDedupe(rows);
    expect(deduped.find((r) => r.status === "active")?.id).toBe("plaid-rich");
  });

  it("ties on completeness and origin fall back to earliest created_at", () => {
    const rows: Row[] = [
      mkExpense("later", "manual", "2026-02-01"),
      mkExpense("earlier", "manual", "2026-01-01"),
    ];
    const deduped = applyLinkDedupe(rows);
    expect(deduped.find((r) => r.status === "active")?.id).toBe("earlier");
  });
});
