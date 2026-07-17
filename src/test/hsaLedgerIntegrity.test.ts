/**
 * Regression tests for atomic HSA ledger integrity + rollback semantics.
 *
 * Covers:
 *  1. Successful income + employee HSA creation
 *  2. Successful income with employee + employer HSA
 *  3. HSA insert failure rolls back the income entry (and its transaction)
 *  4. Income update failure leaves linked HSA unchanged (HSA sync never runs)
 *  5. Zeroing one contribution type removes only that linked row (RPC call
 *     shape: 0 for that role, undefined/null for the other)
 *  6. Deleting income cascades HSA — client no longer pre-deletes HSA rows
 *  7. Retry after failed atomic save uses the same idempotent RPC contract
 *  8. Direct individual contributions (no income_entry_id) are unaffected
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------- shared mock state ----------
type Op =
  | { kind: "insert"; table: string; row: any }
  | { kind: "update"; table: string; patch: any; id?: string }
  | { kind: "delete"; table: string; id?: string }
  | { kind: "rpc"; name: string; args: any };

const ops: Op[] = [];
let rpcBehavior: (name: string, args: any) => { data: any; error: any } = () => ({
  data: { income_entry_id: "ie-1", employee_id: "hsa-emp", employer_id: null },
  error: null,
});
let incomeInsertError: any = null;
let incomeUpdateError: any = null;
let existingBeforeUpdate: any = null;

vi.mock("@/integrations/supabase/client", () => {
  const eqChain = (table: string, kind: "update" | "delete", patch?: any) => ({
    eq: (_col: string, value: string) => {
      ops.push({ kind, table, patch, id: value });
      if (kind === "update" && table === "income_entries" && incomeUpdateError) {
        return { data: null, error: incomeUpdateError };
      }
      return { data: null, error: null };
    },
  });
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } } }),
      },
      from: (table: string) => ({
        insert: (row: any) => {
          ops.push({ kind: "insert", table, row });
          const err = table === "income_entries" ? incomeInsertError : null;
          return {
            select: () => ({
              single: async () => {
                if (err) return { data: null, error: err };
                if (table === "transactions") return { data: { id: "tx-1" }, error: null };
                if (table === "income_entries") return { data: { id: "ie-1" }, error: null };
                return { data: { id: "x" }, error: null };
              },
            }),
          };
        },
        update: (patch: any) => eqChain(table, "update", patch),
        delete: () => eqChain(table, "delete"),
        select: (_cols?: string) => ({
          eq: () => ({
            single: async () => ({ data: existingBeforeUpdate, error: null }),
            maybeSingle: async () => ({ data: existingBeforeUpdate, error: null }),
          }),
          or: () => ({ data: [], error: null }),
          in: () => ({ data: [], error: null }),
        }),
      }),
      rpc: async (name: string, args: any) => {
        ops.push({ kind: "rpc", name, args });
        return rpcBehavior(name, args);
      },
    },
  };
});

vi.mock("@/hooks/useOrgId", () => ({ getUserOrgId: async () => "org-1" }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { useAddIncome, useUpdateIncome, useDeleteIncome } from "@/hooks/useIncome";
import { syncIncomeEntryHsa } from "@/lib/incomeEntryHsaSync";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

function reset() {
  ops.length = 0;
  incomeInsertError = null;
  incomeUpdateError = null;
  existingBeforeUpdate = null;
  rpcBehavior = () => ({
    data: { income_entry_id: "ie-1", employee_id: "hsa-emp", employer_id: null },
    error: null,
  });
}

describe("HSA ledger integrity — atomic sync + rollback", () => {
  beforeEach(reset);

  it("1) successful income + employee HSA creation → RPC called with employee amount", async () => {
    const { result } = renderHook(() => useAddIncome(), { wrapper });
    await result.current.mutateAsync({
      name: "Paycheck",
      company: "Acme",
      income_type: "w2_employee",
      income_date: "2025-06-15",
      paycheck_amount: 5000,
      hsa_contribution: 400,
      status: "received",
    } as any);

    const rpc = ops.find((o) => o.kind === "rpc") as any;
    expect(rpc).toBeTruthy();
    expect(rpc.name).toBe("sync_income_hsa_atomic");
    expect(rpc.args.p_income_entry_id).toBe("ie-1");
    expect(rpc.args.p_employee_amount).toBe(400);
    expect(rpc.args.p_employer_amount).toBe(0);

    // No rollback deletes on success.
    const deletes = ops.filter((o) => o.kind === "delete");
    expect(deletes).toHaveLength(0);
  });

  it("2) successful income with employee + employer HSA → both amounts passed to RPC", async () => {
    const { result } = renderHook(() => useAddIncome(), { wrapper });
    await result.current.mutateAsync({
      name: "Paycheck",
      company: "Acme",
      income_type: "w2_employee",
      income_date: "2025-06-15",
      paycheck_amount: 5000,
      hsa_contribution: 400,
      employer_hsa_contribution: 250,
      status: "received",
    } as any);
    const rpc = ops.find((o) => o.kind === "rpc") as any;
    expect(rpc.args.p_employee_amount).toBe(400);
    expect(rpc.args.p_employer_amount).toBe(250);
  });

  it("3) HSA RPC failure rolls back the income entry AND its transaction", async () => {
    rpcBehavior = () => ({ data: null, error: { message: "unique_violation" } });
    const { result } = renderHook(() => useAddIncome(), { wrapper });
    await expect(
      result.current.mutateAsync({
        name: "Paycheck",
        company: "Acme",
        income_type: "w2_employee",
        income_date: "2025-06-15",
        paycheck_amount: 5000,
        hsa_contribution: 400,
        status: "received",
      } as any),
    ).rejects.toThrow(/HSA sync failed/);

    const deletes = ops.filter((o) => o.kind === "delete") as any[];
    const deletedTables = deletes.map((d) => d.table);
    expect(deletedTables).toContain("income_entries");
    expect(deletedTables).toContain("transactions");
  });

  it("4) income update failure never triggers HSA sync (rollback stays trivially correct)", async () => {
    incomeUpdateError = { message: "update denied" };
    const { result } = renderHook(() => useUpdateIncome(), { wrapper });
    await expect(
      result.current.mutateAsync({
        id: "ie-9",
        hsa_contribution: 999,
      } as any),
    ).rejects.toBeTruthy();
    // RPC must never fire — the update failed before we would have called it.
    expect(ops.find((o) => o.kind === "rpc")).toBeUndefined();
  });

  it("5) zeroing employee HSA calls RPC with p_employee_amount = 0", async () => {
    existingBeforeUpdate = {
      hsa_contribution: 400,
      employer_hsa_contribution: 250,
      income_date: "2025-06-15",
      source_id: null,
    };
    const { result } = renderHook(() => useUpdateIncome(), { wrapper });
    await result.current.mutateAsync({
      id: "ie-1",
      hsa_contribution: 0,
    } as any);
    const rpc = ops.find((o) => o.kind === "rpc") as any;
    expect(rpc.args.p_employee_amount).toBe(0);
    // employer untouched (undefined → null over the wire)
    expect(rpc.args.p_employer_amount).toBeNull();
  });

  it("6) delete income entry no longer pre-deletes HSA rows (CASCADE handles it)", async () => {
    const { result } = renderHook(() => useDeleteIncome(), { wrapper });
    await result.current.mutateAsync("ie-1");
    // Only ONE delete should hit the DB: the parent income_entries row.
    const deletes = ops.filter((o) => o.kind === "delete") as any[];
    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("income_entries");
    // The RPC is never called on delete.
    expect(ops.find((o) => o.kind === "rpc")).toBeUndefined();
  });

  it("7) retry after a failed save uses the same idempotent RPC contract", async () => {
    // First attempt fails.
    rpcBehavior = () => ({ data: null, error: { message: "boom" } });
    await expect(
      syncIncomeEntryHsa({
        incomeEntryId: "ie-1",
        amount: 400,
        employerAmount: 100,
        contributionDate: "2025-06-15",
      }),
    ).rejects.toThrow(/HSA sync failed/);

    // Second attempt succeeds — same call shape, no need to detect prior partial state.
    const firstCall = ops.find((o) => o.kind === "rpc") as any;
    rpcBehavior = () => ({
      data: { income_entry_id: "ie-1", employee_id: "hsa-emp", employer_id: "hsa-er" },
      error: null,
    });
    const res = await syncIncomeEntryHsa({
      incomeEntryId: "ie-1",
      amount: 400,
      employerAmount: 100,
      contributionDate: "2025-06-15",
    });
    const secondCall = ops.filter((o) => o.kind === "rpc")[1] as any;
    expect(secondCall.args).toEqual(firstCall.args);
    expect(res).toEqual({ employeeId: "hsa-emp", employerId: "hsa-er" });
  });

  it("8) direct individual contributions are untouched — RPC only accepts an income_entry_id", async () => {
    // Contract check: the RPC name and arg schema does not allow a null
    // p_income_entry_id. Calling syncIncomeEntryHsa without one throws before
    // ever reaching the DB.
    await expect(
      syncIncomeEntryHsa({
        incomeEntryId: undefined as unknown as string,
        amount: 100,
      }),
    ).rejects.toBeTruthy();
  });

  it("undefined amount over the wire becomes null (RPC = 'do not touch this role')", async () => {
    await syncIncomeEntryHsa({
      incomeEntryId: "ie-1",
      amount: undefined,
      employerAmount: 0,
    });
    const rpc = ops.find((o) => o.kind === "rpc") as any;
    expect(rpc.args.p_employee_amount).toBeNull(); // untouched
    expect(rpc.args.p_employer_amount).toBe(0); // explicit delete
  });
});

describe("HSA ledger integrity — deleteLinkedPayrollHsaForIncomeEntry is a no-op (kept for compat)", () => {
  beforeEach(reset);
  it("does not execute any DB calls (CASCADE replaces it)", async () => {
    const { deleteLinkedPayrollHsaForIncomeEntry } = await import(
      "@/lib/incomeEntryHsaSync"
    );
    await deleteLinkedPayrollHsaForIncomeEntry("ie-42");
    expect(ops).toHaveLength(0);
  });
});
