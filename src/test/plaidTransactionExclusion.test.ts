/**
 * Regression: after a canonical Personal Income entry represents a Plaid
 * deposit, the underlying `transactions` row must be marked excluded so it
 * does not double-count in Dashboard / Tax Overview / reports.
 * Also covers restore on unlink.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory tables the mock reads/writes.
type Row = Record<string, any>;
const state = {
  transactions: [] as Row[],
  income_entries: [] as Row[],
  updates: [] as Array<{ table: string; where: Row; patch: Row }>,
};

function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let action: "select" | "update" | null = null;
  let patch: Row | null = null;
  const chain: any = {
    select() { action = "select"; return chain; },
    update(p: Row) { action = "update"; patch = p; return chain; },
    eq(col: string, val: any) { filters.push((r) => r[col] === val); return chain; },
    in(col: string, vals: any[]) { filters.push((r) => vals.includes(r[col])); return chain; },
    maybeSingle() {
      const rows = (state as any)[table].filter((r: Row) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(res: any) {
      if (action === "update" && patch) {
        const rows = (state as any)[table] as Row[];
        for (const r of rows) if (filters.every((f) => f(r))) {
          Object.assign(r, patch);
          state.updates.push({ table, where: {}, patch: { ...patch } });
        }
        return Promise.resolve({ data: null, error: null }).then(res);
      }
      const rows = ((state as any)[table] as Row[]).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows, error: null }).then(res);
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => makeQuery(t) },
}));

import {
  excludeLinkedTransactionForIncomeEntry,
  restoreLinkedTransactionForIncomeEntry,
} from "@/lib/plaidTransactionExclusion";

beforeEach(() => {
  state.transactions.length = 0;
  state.income_entries.length = 0;
  state.updates.length = 0;
});

describe("plaidTransactionExclusion helpers", () => {
  it("excludes the canonical income tx by transactions.id", async () => {
    state.transactions.push({
      id: "tx-1", transaction_type: "income",
      excluded_from_reports: false, match_status: "unmatched",
    });
    const ids = await excludeLinkedTransactionForIncomeEntry("tx-1");
    expect(ids).toEqual(["tx-1"]);
    const row = state.transactions.find((r) => r.id === "tx-1")!;
    expect(row.excluded_from_reports).toBe(true);
    expect(row.match_status).toBe("linked");
  });

  it("excludes via legacy plaid_transaction_ref convention", async () => {
    state.transactions.push({
      id: "tx-2", plaid_transaction_ref: "plaid-raw-1", transaction_type: "income",
      excluded_from_reports: false, match_status: "unmatched",
    });
    const ids = await excludeLinkedTransactionForIncomeEntry("plaid-raw-1");
    expect(ids).toEqual(["tx-2"]);
    expect(state.transactions[0].excluded_from_reports).toBe(true);
  });

  it("does not touch non-income transactions", async () => {
    state.transactions.push({
      id: "tx-e", transaction_type: "expense",
      excluded_from_reports: false, match_status: "unmatched",
    });
    const ids = await excludeLinkedTransactionForIncomeEntry("tx-e");
    expect(ids).toEqual([]);
    expect(state.transactions[0].excluded_from_reports).toBe(false);
  });

  it("no-ops when linked_transaction_id is null", async () => {
    const ids = await excludeLinkedTransactionForIncomeEntry(null);
    expect(ids).toEqual([]);
  });

  it("restores the tx on unlink when no other canonical entry represents it", async () => {
    state.transactions.push({
      id: "tx-3", transaction_type: "income",
      excluded_from_reports: true, match_status: "linked",
    });
    state.income_entries.push({
      id: "ie-imp", linked_transaction_id: "tx-3", status: "merged",
    });
    const ids = await restoreLinkedTransactionForIncomeEntry("tx-3", "ie-imp");
    expect(ids).toEqual(["tx-3"]);
    expect(state.transactions[0].excluded_from_reports).toBe(false);
    expect(state.transactions[0].match_status).toBe("unmatched");
  });

  it("does NOT restore the tx if another canonical entry still represents it", async () => {
    state.transactions.push({
      id: "tx-4", transaction_type: "income",
      excluded_from_reports: true, match_status: "linked",
    });
    state.income_entries.push({ id: "ie-a", linked_transaction_id: "tx-4", status: "merged" });
    state.income_entries.push({ id: "ie-b", linked_transaction_id: "tx-4", status: "received" });
    const ids = await restoreLinkedTransactionForIncomeEntry("tx-4", "ie-a");
    expect(ids).toEqual([]);
    expect(state.transactions[0].excluded_from_reports).toBe(true);
  });

  it("dissolve unlink: excludeIds array restores tx even though merged sibling is still merged", async () => {
    // Simulates the unlink path BEFORE we've flipped statuses back to
    // "received" — caller passes all removed entry ids as the exclude list.
    state.transactions.push({
      id: "tx-5", transaction_type: "income",
      excluded_from_reports: true, match_status: "linked",
    });
    state.income_entries.push({ id: "ie-can", linked_transaction_id: null, status: "received" });
    state.income_entries.push({ id: "ie-imp", linked_transaction_id: "tx-5", status: "merged" });
    const ids = await restoreLinkedTransactionForIncomeEntry("tx-5", ["ie-can", "ie-imp"]);
    expect(ids).toEqual(["tx-5"]);
    expect(state.transactions[0].excluded_from_reports).toBe(false);
    expect(state.transactions[0].match_status).toBe("unmatched");
  });

  it("merged rows alone (without exclude) do not count as active representation", async () => {
    state.transactions.push({
      id: "tx-6", transaction_type: "income",
      excluded_from_reports: true, match_status: "linked",
    });
    // Only a stale "merged" sibling exists and is NOT in the exclude list.
    // Per new semantics merged rows are shadows, so restoration proceeds.
    state.income_entries.push({ id: "ie-stale", linked_transaction_id: "tx-6", status: "merged" });
    const ids = await restoreLinkedTransactionForIncomeEntry("tx-6");
    expect(ids).toEqual(["tx-6"]);
    expect(state.transactions[0].excluded_from_reports).toBe(false);
  });
});

describe("two-paycheck QA regression aggregation", () => {
  it("after both deposits are excluded, business tx aggregation is 0 (personal totals $20k)", async () => {
    // Two Plaid deposits routed to canonical `transactions` (transaction_type=income).
    state.transactions.push(
      { id: "tx-p1", transaction_type: "income", amount: 6485, excluded_from_reports: false, match_status: "unmatched" },
      { id: "tx-p2", transaction_type: "income", amount: 6485, excluded_from_reports: false, match_status: "unmatched" },
    );
    await excludeLinkedTransactionForIncomeEntry("tx-p1");
    await excludeLinkedTransactionForIncomeEntry("tx-p2");
    // Dashboard filter: businessIncome sums only rows where excluded_from_reports === false.
    const reportable = state.transactions.filter((t) => !t.excluded_from_reports);
    const businessIncome = reportable.reduce((s, t) => s + Number(t.amount || 0), 0);
    expect(businessIncome).toBe(0);
    // The rows are preserved for bank history.
    expect(state.transactions).toHaveLength(2);
  });
});
