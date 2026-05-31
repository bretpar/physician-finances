/**
 * Regression tests for Business Activity → useAddIncome
 * recommended_withholding persistence.
 *
 * Bug: useAddIncome unconditionally recomputed recommended_withholding with a
 * legacy 35% (self-employed) / 25% (W-2) flat rate, overwriting the canonical
 * value the user saw in Business Activity ("Recommended to set aside"). After
 * the Social Security wage base, the visible recommendation (e.g. $3,119 on a
 * $10,000 1099 entry) was silently saved as $3,500.
 *
 * Fix: preserve a caller-supplied `recommended_withholding` on the payload.
 * Only fall back to the legacy estimate when nothing was supplied. Explicit 0
 * must be preserved as 0.
 *
 * These tests mock supabase + org lookup and assert the value written to the
 * `transactions` row matches the contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const insertedTxRows: any[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const selectSingle = (returnRow: any) => ({
    select: () => ({ single: async () => ({ data: returnRow, error: null }) }),
  });
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } } }),
      },
      from: (table: string) => ({
        insert: (row: any) => {
          if (table === "transactions") {
            insertedTxRows.push(row);
            return selectSingle({ id: "tx-1" });
          }
          if (table === "income_entries") {
            return selectSingle({ id: "ie-1" });
          }
          return selectSingle({ id: "x" });
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      }),
    },
  };
});

vi.mock("@/hooks/useOrgId", () => ({
  getUserOrgId: async () => "org-1",
}));

vi.mock("@/hooks/useHsaContributions", () => ({
  syncPayrollHsaForIncome: async () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

import { useAddIncome } from "@/hooks/useIncome";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

async function runAdd(payload: any) {
  insertedTxRows.length = 0;
  const { result } = renderHook(() => useAddIncome(), { wrapper });
  await result.current.mutateAsync(payload);
  return insertedTxRows[0];
}

describe("useAddIncome — recommended_withholding persistence", () => {
  beforeEach(() => {
    insertedTxRows.length = 0;
  });

  it("preserves supplied $3,119 visible recommendation (post-SS-cap scenario)", async () => {
    const row = await runAdd({
      name: "Independent Ortho Consulting",
      company: "Independent Ortho Consulting",
      income_type: "1099_schedule_c",
      paycheck_amount: 10000,
      recommended_withholding: 3119,
    });
    expect(row.recommended_withholding).toBe(3119);
  });

  it("preserves explicit 0 as 0 (does not overwrite with 35%)", async () => {
    const row = await runAdd({
      name: "Independent Ortho Consulting",
      company: "Independent Ortho Consulting",
      income_type: "1099_schedule_c",
      paycheck_amount: 10000,
      recommended_withholding: 0,
    });
    expect(row.recommended_withholding).toBe(0);
  });

  it("falls back to legacy 35% for $10,000 self-employed when no recommendation supplied", async () => {
    const row = await runAdd({
      name: "Independent Ortho Consulting",
      company: "Independent Ortho Consulting",
      income_type: "1099_schedule_c",
      paycheck_amount: 10000,
    });
    expect(row.recommended_withholding).toBe(3500);
  });

  it("matches when visible recommendation equals legacy fallback ($3,500)", async () => {
    const row = await runAdd({
      name: "Independent Ortho Consulting",
      company: "Independent Ortho Consulting",
      income_type: "1099_schedule_c",
      paycheck_amount: 10000,
      recommended_withholding: 3500,
    });
    expect(row.recommended_withholding).toBe(3500);
  });
});
