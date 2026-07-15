import { describe, it, expect } from "vitest";
import { filterNonOrphanIncomeEntries, isOrphanIncomeEntry } from "@/lib/incomeOrphanFilter";

describe("incomeOrphanFilter — useTaxEstimate reconciliation rules", () => {
  const liveTx = new Set(["tx-1", "tx-2"]);
  const plaidTx = new Set(["plaid-1", "plaid-2"]);

  it("does not treat unlinked income_entries as orphans", () => {
    expect(isOrphanIncomeEntry({ linked_transaction_id: null }, liveTx, plaidTx)).toBe(false);
    expect(isOrphanIncomeEntry({ linked_transaction_id: undefined }, liveTx, plaidTx)).toBe(false);
  });

  it("does not treat entries linked to a live app transaction as orphans", () => {
    expect(isOrphanIncomeEntry({ linked_transaction_id: "tx-1" }, liveTx, plaidTx)).toBe(false);
  });

  it("does not treat entries linked to a raw plaid_transactions.id as orphans (Plaid orphan fix)", () => {
    // Regression: personal Plaid-imported deposits that were never promoted
    // into the canonical `transactions` table must not be dropped from tax
    // reconciliation just because their linked id lives in plaid_transactions.
    expect(isOrphanIncomeEntry({ linked_transaction_id: "plaid-1" }, liveTx, plaidTx)).toBe(false);
  });

  it("treats entries linked to neither table as orphans", () => {
    expect(isOrphanIncomeEntry({ linked_transaction_id: "missing-id" }, liveTx, plaidTx)).toBe(true);
  });

  it("filterNonOrphanIncomeEntries retains live-linked, plaid-linked, and unlinked; drops truly orphaned rows", () => {
    const rows = [
      { id: "a", linked_transaction_id: "tx-2" },
      { id: "b", linked_transaction_id: "plaid-2" },
      { id: "c", linked_transaction_id: null },
      { id: "d", linked_transaction_id: "nowhere" },
    ];
    const kept = filterNonOrphanIncomeEntries(rows, liveTx, plaidTx);
    expect(kept.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not treat plaid_transactions rows as independently reportable — filter only decides orphan status", () => {
    // Sanity check on scope: this helper never fabricates income rows from
    // plaid_transactions ids on its own. It only decides whether an existing
    // income_entry pointing at a plaid_transactions.id is an orphan.
    const rows = [{ id: "only", linked_transaction_id: "plaid-1" }];
    expect(filterNonOrphanIncomeEntries(rows, liveTx, plaidTx)).toHaveLength(1);
    expect(filterNonOrphanIncomeEntries([], liveTx, plaidTx)).toEqual([]);
  });
});
