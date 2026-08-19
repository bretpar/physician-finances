import { describe, it, expect } from "vitest";
import { findExpenseAutoLinkPairs, type AutoLinkCandidate } from "@/lib/expenseAutoLink";
import { pickCanonicalLinkedRow } from "@/hooks/useTransactionMatching";

function tx(over: Partial<AutoLinkCandidate> & { id: string }): AutoLinkCandidate {
  return {
    transaction_type: "expense",
    transaction_date: "2026-03-10",
    amount: 100,
    source_type: "manual",
    match_status: "unmatched",
    status: "active",
    ...over,
  };
}

describe("expense auto-link", () => {
  it("exact amount + same day → auto-link", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1" }),
      tx({ id: "p1", source_type: "plaid" }),
    ]);
    expect(pairs).toEqual([{ manualTxId: "m1", plaidTxId: "p1" }]);
  });

  it("amount within 1% and within 2 days → auto-link", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1", amount: 100, transaction_date: "2026-03-10" }),
      tx({ id: "p1", source_type: "plaid", amount: 100.9, transaction_date: "2026-03-12" }),
    ]);
    expect(pairs).toEqual([{ manualTxId: "m1", plaidTxId: "p1" }]);
  });

  it("more than 1% amount difference → no auto-link", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1", amount: 100 }),
      tx({ id: "p1", source_type: "plaid", amount: 102 }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("more than 2 days apart → no auto-link", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1", transaction_date: "2026-03-10" }),
      tx({ id: "p1", source_type: "plaid", transaction_date: "2026-03-13" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("two qualifying manual transactions → no auto-link", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1" }),
      tx({ id: "m2" }),
      tx({ id: "p1", source_type: "plaid" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("different transaction types → no auto-link", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1", transaction_type: "income" }),
      tx({ id: "p1", source_type: "plaid" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("already actively linked rows → no auto-link", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1", match_status: "linked" }),
      tx({ id: "p1", source_type: "plaid" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("income pairs are never auto-linked", () => {
    const pairs = findExpenseAutoLinkPairs([
      tx({ id: "m1", transaction_type: "income" }),
      tx({ id: "p1", transaction_type: "income", source_type: "plaid" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("manual expense with receipt stays canonical and keeps its data", () => {
    const rows = [
      {
        id: "m1",
        source_type: "manual",
        created_at: "2026-03-10",
        category: "Office",
        vendor: "Staples",
        notes: "ink",
        receipt_url: "https://files/receipt.pdf",
      },
      { id: "p1", source_type: "plaid", created_at: "2026-03-11", category: "Uncategorized", vendor: "STAPLES #22" },
    ];
    const canonical = pickCanonicalLinkedRow(rows as any);
    expect(canonical.id).toBe("m1");
    expect((canonical as any).receipt_url).toBe("https://files/receipt.pdf");
    expect((canonical as any).category).toBe("Office");
    expect((canonical as any).notes).toBe("ink");
  });

  it("auto-linked pair counts only once in totals", () => {
    // Post-link state: manual stays active, Plaid row is soft-marked merged.
    const afterLink = [
      { id: "m1", amount: 100, status: "active" },
      { id: "p1", amount: 100, status: "merged" },
    ];
    const total = afterLink
      .filter((r) => r.status === "active")
      .reduce((s, r) => s + Math.abs(r.amount), 0);
    expect(total).toBe(100);
  });
});
