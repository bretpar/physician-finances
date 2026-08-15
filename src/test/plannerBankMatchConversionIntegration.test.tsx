/**
 * Integration: converting a Planner occurrence that already matches an imported
 * Plaid deposit must ENRICH the existing bank transaction — preserving its id,
 * amount, account_source and bank metadata — and reuse the single mirror
 * income_entries row (keeping linked_transaction_id) instead of inserting a
 * duplicate `account_source = "Planner"` transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

type Op = { kind: "insert" | "update"; table: string; payload: any; filters?: Record<string, any> };

const ops: Op[] = [];

const BANK_TX = {
  id: "tx-plaid-1",
  amount: 7500,
  account_source: "Chase Checking",
  plaid_transaction_id: "plaid-abc",
};
let mirrorRow: { id: string } | null = { id: "ie-mirror-1" };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/useOrgId", () => ({
  getUserOrgId: async () => "org-1",
  useOrgId: () => ({ data: "org-1" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: () => {
        const chain: any = {
          eq: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({
            data: table === "income_entries" ? mirrorRow : null,
            error: null,
          }),
          single: async () => ({ data: null, error: null }),
        };
        return chain;
      },
      insert: (payload: any) => {
        ops.push({ kind: "insert", table, payload });
        const chain: any = {
          select: () => chain,
          single: async () => ({ data: { id: `${table}-new` }, error: null }),
          maybeSingle: async () => ({ data: { id: `${table}-new` }, error: null }),
          then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
        };
        return chain;
      },
      update: (payload: any) => {
        const filters: Record<string, any> = {};
        const chain: any = {
          eq: (col: string, v: any) => {
            filters[col] = v;
            ops.push({ kind: "update", table, payload, filters });
            return chain;
          },
          select: () => chain,
          single: async () => ({ data: BANK_TX, error: null }),
          then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
        };
        return chain;
      },
      delete: () => {
        const chain: any = {
          eq: () => Promise.resolve({ data: null, error: null }),
          then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
        };
        return chain;
      },
    }),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

async function convert(existingTransactionId: string | null) {
  const { useManualPlannerConvert } = await import("@/hooks/useProjectedIncome");
  const { result } = renderHook(() => useManualPlannerConvert(), { wrapper });
  await result.current.mutateAsync({
    streamId: "s-1",
    bonusEventId: null,
    occurrenceDate: "2026-08-14",
    ledgerBucket: "business",
    label: "Locum Co",
    sourceId: "co-1",
    incomeType: "1099_schedule_c",
    grossAmount: 10675,
    taxesWithheld: 0,
    preTaxDeductions: 2693,
    retirement401k: 320,
    healthcareDeduction: 2493,
    hsaContribution: 200,
    federalWithholding: 0,
    stateWithholding: 0,
    ssWithholding: 0,
    medicareWithholding: 0,
    hasDetailedBreakdown: true,
    existingTransactionId,
    isBonus: false,
  } as any);
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
}

beforeEach(() => {
  ops.length = 0;
  mirrorRow = { id: "ie-mirror-1" };
});

describe("Planner conversion onto an imported Plaid deposit", () => {
  it("preserves the bank transaction and never inserts a Planner transaction", async () => {
    await convert(BANK_TX.id);

    const txInserts = ops.filter((o) => o.kind === "insert" && o.table === "transactions");
    expect(txInserts).toHaveLength(0);

    const txUpdate = ops.find((o) => o.kind === "update" && o.table === "transactions");
    expect(txUpdate).toBeTruthy();
    expect(txUpdate!.filters).toEqual({ id: BANK_TX.id });
    // Bank-owned fields must never be overwritten by planner values.
    expect(txUpdate!.payload).not.toHaveProperty("amount");
    expect(txUpdate!.payload).not.toHaveProperty("account_source");
    expect(txUpdate!.payload).not.toHaveProperty("vendor");
    expect(txUpdate!.payload).not.toHaveProperty("transaction_date");
    expect(txUpdate!.payload.origin_type).toBe("planner_converted");
  });

  it("reuses the mirror income entry, keeps the link, and uses the real deposited amount", async () => {
    await convert(BANK_TX.id);

    const ieInserts = ops.filter((o) => o.kind === "insert" && o.table === "income_entries");
    expect(ieInserts).toHaveLength(0);

    const ieUpdate = ops.find((o) => o.kind === "update" && o.table === "income_entries");
    expect(ieUpdate).toBeTruthy();
    expect(ieUpdate!.filters).toEqual({ id: "ie-mirror-1" });
    expect(ieUpdate!.payload.linked_transaction_id).toBe(BANK_TX.id);
    // Net Received comes from the actual bank deposit, not the planner estimate.
    expect(ieUpdate!.payload.deposited_amount).toBe(BANK_TX.amount);
    // Deductions are still split exactly once (no double count).
    expect(ieUpdate!.payload.healthcare_deduction).toBe(2493);
    expect(ieUpdate!.payload.hsa_contribution).toBe(200);
    expect(ieUpdate!.payload.pre_tax_deductions).toBe(0);
    // The conversion record points at the existing bank transaction.
    const convLink = ops.find(
      (o) => o.kind === "update" && o.table === "planner_conversions" && o.payload?.transaction_id,
    );
    expect(convLink!.payload.transaction_id).toBe(BANK_TX.id);
  });

  it("creates one mirror row when no income entry is linked yet", async () => {
    mirrorRow = null;
    await convert(BANK_TX.id);

    const ieInserts = ops.filter((o) => o.kind === "insert" && o.table === "income_entries");
    expect(ieInserts).toHaveLength(1);
    expect(ieInserts[0].payload.linked_transaction_id).toBe(BANK_TX.id);
    expect(ieInserts[0].payload.deposited_amount).toBe(BANK_TX.amount);
    expect(ops.filter((o) => o.kind === "insert" && o.table === "transactions")).toHaveLength(0);
  });

  it("falls back to a Planner transaction only when there is no bank match", async () => {
    await convert(null);

    const txInserts = ops.filter((o) => o.kind === "insert" && o.table === "transactions");
    expect(txInserts).toHaveLength(1);
    expect(txInserts[0].payload.account_source).toBe("Planner");
    expect(txInserts[0].payload.amount).toBe(10675);
  });
});
