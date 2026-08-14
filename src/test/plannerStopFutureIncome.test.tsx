/**
 * Planner deletes are forecast-only:
 *  - a recurring stream with history is TRUNCATED (end_date = yesterday) and
 *    future bonuses/overrides removed; no ledger row is ever deleted.
 *  - a stream that starts today or later is hard-deleted.
 *  - skipping an occurrence never deletes ledger rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

type Op =
  | { kind: "insert"; table: string }
  | { kind: "update"; table: string; patch: any }
  | { kind: "delete"; table: string; filters: Record<string, any> };

const ops: Op[] = [];
let streamRow: any = { id: "s1", start_date: "2026-01-01" };

vi.mock("@/hooks/useOrgId", () => ({
  getUserOrgId: async () => "org-1",
  useOrgId: () => ({ data: "org-1" }),
}));

vi.mock("@/lib/localDate", () => ({
  getTodayLocalDateString: () => "2026-08-14",
  DEFAULT_TIMEZONE: "America/Los_Angeles",
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: () => {
        const chain: any = {
          eq: () => chain,
          maybeSingle: async () => ({
            data: table === "projected_income_streams" ? streamRow : null,
            error: null,
          }),
        };
        return chain;
      },
      insert: () => {
        ops.push({ kind: "insert", table });
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: any) => {
        const chain: any = {
          eq: () => {
            ops.push({ kind: "update", table, patch });
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
      delete: () => {
        const filters: Record<string, any> = {};
        const chain: any = {
          eq: (col: string, v: any) => {
            filters[col] = v;
            ops.push({ kind: "delete", table, filters });
            return chain;
          },
          gte: (col: string, v: any) => {
            filters[`gte:${col}`] = v;
            return chain;
          },
          then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
        };
        return chain;
      },
    }),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

async function runStreamDelete(id: string) {
  const { useDeleteStream } = await import("@/hooks/useProjectedIncome");
  const { result } = renderHook(() => useDeleteStream(), { wrapper });
  let res: any;
  await waitFor(async () => {
    res = await result.current.mutateAsync(id);
  });
  return res;
}

const deletes = (table: string) => ops.filter((o) => o.kind === "delete" && o.table === table) as any[];
const updates = (table: string) => ops.filter((o) => o.kind === "update" && o.table === table) as any[];

beforeEach(() => {
  ops.length = 0;
  streamRow = { id: "s1", start_date: "2026-01-01" };
});

describe("stop future income (stream delete)", () => {
  it("truncates a stream that already has history instead of deleting it", async () => {
    const res = await runStreamDelete("s1");
    expect(res.mode).toBe("stopped");
    expect(updates("projected_income_streams")[0].patch).toEqual({ end_date: "2026-08-13" });
    expect(deletes("projected_income_streams")).toHaveLength(0);
  });

  it("never deletes ledger rows or planner_conversions", async () => {
    await runStreamDelete("s1");
    expect(deletes("income_entries")).toHaveLength(0);
    expect(deletes("transactions")).toHaveLength(0);
    expect(deletes("planner_conversions")).toHaveLength(0);
  });

  it("removes only today/future bonuses and overrides", async () => {
    await runStreamDelete("s1");
    const bonus = deletes("projected_bonus_events")[0];
    const overrides = deletes("projected_income_overrides")[0];
    expect(bonus.filters["gte:scheduled_date"]).toBe("2026-08-14");
    expect(overrides.filters["gte:override_date"]).toBe("2026-08-14");
  });

  it("hard-deletes a stream that starts today or later (no history)", async () => {
    streamRow = { id: "s2", start_date: "2026-09-01" };
    const res = await runStreamDelete("s2");
    expect(res.mode).toBe("deleted");
    expect(deletes("projected_income_streams")[0].filters.id).toBe("s2");
    expect(deletes("income_entries")).toHaveLength(0);
    expect(deletes("transactions")).toHaveLength(0);
  });
});

describe("skip override", () => {
  it("never deletes ledger rows", async () => {
    const { useAddOverride } = await import("@/hooks/useProjectedIncome");
    const { result } = renderHook(() => useAddOverride(), { wrapper });
    await waitFor(async () => {
      await result.current.mutateAsync({
        stream_id: "s1",
        override_date: "2026-08-28",
        action: "skip",
      });
    });
    expect(deletes("income_entries")).toHaveLength(0);
    expect(deletes("transactions")).toHaveLength(0);
    expect(deletes("planner_conversions")).toHaveLength(0);
    expect(ops.some((o) => o.kind === "insert" && o.table === "projected_income_overrides")).toBe(true);
  });
});
