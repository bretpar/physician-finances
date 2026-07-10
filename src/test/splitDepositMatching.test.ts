/**
 * Split-deposit suggested-matches: one Plaid deposit ↔ multiple manual
 * income entries. Verifies the combo pass in useSuggestedMatches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ data: [], error: null }),
        data: [],
        error: null,
      }),
    }),
  },
}));

import { useSuggestedMatches } from "@/hooks/useTransactionMatching";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { IncomeEntry } from "@/hooks/useIncome";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

const mkManual = (over: Partial<DbTransaction> = {}): DbTransaction =>
  ({
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    source_type: "manual",
    transaction_type: "income",
    match_status: "unmatched",
    amount: 5000,
    transaction_date: "2026-07-01",
    vendor: "Hospital A",
    entity: "Hospital A",
    ...over,
  }) as any;

const mkPlaid = (over: Partial<DbTransaction> = {}): DbTransaction =>
  ({
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    source_type: "plaid",
    transaction_type: "income",
    match_status: "unmatched",
    amount: 10000,
    transaction_date: "2026-07-01",
    vendor: "PAYROLL DEPOSIT",
    entity: "Hospital A",
    account_source: "Checking",
    ...over,
  }) as any;

const mkIE = (txId: string, over: Partial<IncomeEntry> = {}): IncomeEntry =>
  ({
    id: `ie-${txId}`,
    linked_transaction_id: txId,
    paycheck_amount: 5000,
    deposited_amount: 3500, // net after withholding
    federal_withholding: 0,
    state_withholding: 0,
    ss_withholding: 0,
    medicare_withholding: 0,
    pre_tax_deductions: 0,
    retirement_401k: 0,
    ...over,
  }) as any;

const run = (txs: DbTransaction[], ies?: IncomeEntry[]) =>
  renderHook(() => useSuggestedMatches(txs, ies), { wrapper }).result.current;

describe("split-deposit suggested matches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("suggests a 2-manual split when nets sum to the deposit", () => {
    const m1 = mkManual({ id: "m1", amount: 5000 });
    const m2 = mkManual({ id: "m2", amount: 5000, transaction_date: "2026-07-02" });
    // Deposit of 7000 = 3500 + 3500 nets
    const p = mkPlaid({ id: "p1", amount: 7000 });
    const ies = [mkIE("m1"), mkIE("m2")];

    const out = run([m1, m2, p], ies);
    const split = out.find((s) => s.kind === "split");
    expect(split, "expected a split suggestion").toBeTruthy();
    if (split && split.kind === "split") {
      expect(split.plaidTx.id).toBe("p1");
      expect(split.manualTxs.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
      expect(split.confidenceLabel).toBe("Strong match");
    }
    // Plaid tx should not also appear in a single suggestion
    expect(out.filter((s) => (s as any).plaidTx?.id === "p1")).toHaveLength(1);
  });

  it("suggests a 3-manual split within 5 days", () => {
    const m1 = mkManual({ id: "m1", amount: 3000, transaction_date: "2026-07-01" });
    const m2 = mkManual({ id: "m2", amount: 3000, transaction_date: "2026-07-03" });
    const m3 = mkManual({ id: "m3", amount: 3000, transaction_date: "2026-07-05" });
    const p = mkPlaid({ id: "p1", amount: 6000, transaction_date: "2026-07-03" });
    const ies = [
      mkIE("m1", { paycheck_amount: 3000, deposited_amount: 2000 }),
      mkIE("m2", { paycheck_amount: 3000, deposited_amount: 2000 }),
      mkIE("m3", { paycheck_amount: 3000, deposited_amount: 2000 }),
    ];
    const out = run([m1, m2, m3, p], ies);
    const split = out.find((s) => s.kind === "split");
    expect(split).toBeTruthy();
    if (split && split.kind === "split") {
      expect(split.manualTxs).toHaveLength(3);
    }
  });

  it("does NOT suggest a combo whose sum is >5% off the deposit", () => {
    const m1 = mkManual({ id: "m1", amount: 5000 });
    const m2 = mkManual({ id: "m2", amount: 5000 });
    // Nets sum to 7000 but deposit is 9000 → 28% off
    const p = mkPlaid({ id: "p1", amount: 9000 });
    const ies = [mkIE("m1"), mkIE("m2")];
    const out = run([m1, m2, p], ies);
    expect(out.find((s) => s.kind === "split")).toBeUndefined();
  });

  it("skips combo when a strong single already matches the same Plaid tx", () => {
    // p1 nets 3500 exactly to m1 (strong single), and m2/m3 would sum to 7000
    const m1 = mkManual({ id: "m1", amount: 5000 });
    const m2 = mkManual({ id: "m2", amount: 5000 });
    const m3 = mkManual({ id: "m3", amount: 5000 });
    const p = mkPlaid({ id: "p1", amount: 3500 });
    const ies = [mkIE("m1"), mkIE("m2"), mkIE("m3")];
    const out = run([m1, m2, m3, p], ies);
    expect(out.some((s) => s.kind === "split")).toBe(false);
    expect(out.some((s) => s.kind === "single" && (s as any).manualTx.id === "m1")).toBe(true);
  });

  it("respects tx dedup: manual in a chosen split cannot appear elsewhere", () => {
    const m1 = mkManual({ id: "m1", amount: 5000 });
    const m2 = mkManual({ id: "m2", amount: 5000 });
    const p = mkPlaid({ id: "p1", amount: 7000 });
    // Another plaid deposit that would weakly match m1 alone
    const p2 = mkPlaid({
      id: "p2",
      amount: 3500,
      transaction_date: "2026-07-04",
      vendor: "OTHER",
    });
    const ies = [mkIE("m1"), mkIE("m2")];
    const out = run([m1, m2, p, p2], ies);
    const usingM1 = out.filter((s) =>
      s.kind === "split"
        ? s.manualTxs.some((m) => m.id === "m1")
        : (s as any).manualTx?.id === "m1",
    );
    expect(usingM1).toHaveLength(1);
  });
});
