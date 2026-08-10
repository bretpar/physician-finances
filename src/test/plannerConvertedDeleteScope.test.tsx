/**
 * Focused tests for deleting a CONVERTED planner occurrence.
 *
 *  - scope "planner": planner occurrence removed (skip override), conversion
 *    link dropped, linked ledger transaction LEFT UNTOUCHED.
 *  - scope "both": linked ledger row (income_entries or transactions) deleted
 *    AND the planner occurrence removed.
 *  - unrelated ledger rows are never touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

type Op =
  | { kind: "insert"; table: string; row: any }
  | { kind: "delete"; table: string; id?: string };

const ops: Op[] = [];
let conversion: any = null;

vi.mock("@/hooks/useOrgId", () => ({
  getUserOrgId: async () => "org-1",
  useOrgId: () => ({ data: "org-1" }),
}));

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => ({
        select: () => {
          const chain: any = {
            eq: () => chain,
            maybeSingle: async () => ({
              data: table === "planner_conversions" ? conversion : null,
              error: null,
            }),
          };
          return chain;
        },
        insert: (row: any) => {
          ops.push({ kind: "insert", table, row });
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => ({
          eq: (_col: string, value: string) => {
            ops.push({ kind: "delete", table, id: value });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    },
  };
});

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

async function runDelete(input: any) {
  const { useDeleteConvertedOccurrence } = await import("@/hooks/useProjectedIncome");
  const { result } = renderHook(() => useDeleteConvertedOccurrence(), { wrapper });
  let res: any;
  await waitFor(async () => {
    res = await result.current.mutateAsync(input);
  });
  return res;
}

const deletes = (table: string) => ops.filter((o) => o.kind === "delete" && o.table === table);
const skipInserts = () =>
  ops.filter((o) => o.kind === "insert" && o.table === "projected_income_overrides") as any[];

beforeEach(() => {
  ops.length = 0;
  conversion = null;
});

describe("converted planner occurrence delete scope", () => {
  it("'planner' leaves the linked personal income ledger entry untouched", async () => {
    conversion = { id: "conv-1", income_entry_id: "ie-1", transaction_id: null };

    const res = await runDelete({
      scope: "planner",
      streamId: "stream-1",
      occurrenceDate: "2026-08-14",
    });

    expect(res.ledgerDeleted).toBe(0);
    expect(deletes("income_entries")).toHaveLength(0);
    expect(deletes("transactions")).toHaveLength(0);
    // conversion link dropped so the row no longer shows as converted
    expect(deletes("planner_conversions").map((d: any) => d.id)).toEqual(["conv-1"]);
    // planner occurrence removed via skip override
    expect(skipInserts()).toHaveLength(1);
    expect(skipInserts()[0].row).toMatchObject({
      stream_id: "stream-1",
      override_date: "2026-08-14",
      action: "skip",
    });
  });

  it("'planner' leaves a linked business transaction untouched", async () => {
    conversion = { id: "conv-2", income_entry_id: null, transaction_id: "tx-9" };

    const res = await runDelete({
      scope: "planner",
      streamId: "stream-2",
      occurrenceDate: "2026-09-01",
    });

    expect(res.ledgerDeleted).toBe(0);
    expect(deletes("transactions")).toHaveLength(0);
    expect(skipInserts()).toHaveLength(1);
  });

  it("'both' deletes the linked personal income entry AND the planner occurrence", async () => {
    conversion = { id: "conv-3", income_entry_id: "ie-7", transaction_id: null };

    const res = await runDelete({
      scope: "both",
      streamId: "stream-3",
      occurrenceDate: "2026-08-28",
    });

    expect(res.ledgerDeleted).toBe(1);
    expect(deletes("income_entries").map((d: any) => d.id)).toEqual(["ie-7"]);
    expect(deletes("transactions")).toHaveLength(0);
    expect(deletes("planner_conversions").map((d: any) => d.id)).toEqual(["conv-3"]);
    expect(skipInserts()).toHaveLength(1);
  });

  it("'both' deletes the linked business transaction AND the planner occurrence", async () => {
    conversion = { id: "conv-4", income_entry_id: null, transaction_id: "tx-4" };

    const res = await runDelete({
      scope: "both",
      streamId: "stream-4",
      occurrenceDate: "2026-10-15",
    });

    expect(res.ledgerDeleted).toBe(1);
    expect(deletes("transactions").map((d: any) => d.id)).toEqual(["tx-4"]);
    expect(skipInserts()).toHaveLength(1);
  });

  it("only deletes ids referenced by the conversion link (no unrelated rows)", async () => {
    conversion = { id: "conv-5", income_entry_id: "ie-only", transaction_id: null };

    await runDelete({ scope: "both", streamId: "s", occurrenceDate: "2026-08-14" });

    const ledgerDeleteIds = [...deletes("income_entries"), ...deletes("transactions")].map(
      (d: any) => d.id,
    );
    expect(ledgerDeleteIds).toEqual(["ie-only"]);
  });

  it("replaces an existing override with the skip when deleting planner-only", async () => {
    conversion = { id: "conv-6", income_entry_id: "ie-6", transaction_id: null };

    await runDelete({
      scope: "planner",
      streamId: "stream-6",
      occurrenceDate: "2026-08-14",
      existingOverrideId: "ovr-6",
    });

    expect(deletes("projected_income_overrides").map((d: any) => d.id)).toEqual(["ovr-6"]);
    expect(skipInserts()).toHaveLength(1);
    expect(deletes("income_entries")).toHaveLength(0);
  });

  it("bonus occurrences delete the bonus event; 'planner' keeps its ledger row", async () => {
    conversion = { id: "conv-7", income_entry_id: "ie-b", transaction_id: null };

    await runDelete({
      scope: "planner",
      streamId: "stream-7",
      occurrenceDate: "2026-12-01",
      bonusEventId: "bonus-1",
    });

    expect(deletes("projected_bonus_events").map((d: any) => d.id)).toEqual(["bonus-1"]);
    expect(deletes("income_entries")).toHaveLength(0);
    expect(skipInserts()).toHaveLength(0);
  });

  it("bonus occurrences with scope 'both' delete the ledger row too", async () => {
    conversion = { id: "conv-8", income_entry_id: null, transaction_id: "tx-b" };

    const res = await runDelete({
      scope: "both",
      streamId: "stream-8",
      occurrenceDate: "2026-12-01",
      bonusEventId: "bonus-2",
    });

    expect(res.ledgerDeleted).toBe(1);
    expect(deletes("transactions").map((d: any) => d.id)).toEqual(["tx-b"]);
    expect(deletes("projected_bonus_events").map((d: any) => d.id)).toEqual(["bonus-2"]);
  });
});
