import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useManualPlannerConvert } from "@/hooks/useProjectedIncome";

const db = vi.hoisted(() => ({
  periods: [] as Array<{ id: string; company_id: string; closed_on: string; reopened_on: string | null }>,
  failure: false,
  companyFailure: false,
  conversions: [] as Array<Record<string, unknown>>,
  income: [{ id: "historical", paycheck_amount: 1234 }] as Array<Record<string, unknown>>,
  writes: [] as string[],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useOrgId", () => ({ getUserOrgId: async () => "org" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const response = () => {
        if (table === "company_closure_periods") return { data: db.periods, error: db.failure ? new Error("lookup failed") : null };
        if (table === "companies") return { data: [{ id: "co", name: "Acme" }], error: db.companyFailure ? new Error("lookup failed") : null };
        return { data: db.conversions.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null };
      };
      const chain: any = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
        maybeSingle: async () => response(),
        then: (resolve: any) => Promise.resolve(response()).then(resolve),
      };
      return {
        select: () => chain,
        insert: (payload: Record<string, unknown>) => {
          db.writes.push(`insert:${table}`);
          const row = { ...payload, id: `${table}-${db.writes.length}` };
          if (table === "planner_conversions") db.conversions.push(row);
          if (table === "income_entries") db.income.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        update: () => {
          db.writes.push(`update:${table}`);
          return { eq: async () => ({ data: null, error: null }) };
        },
        delete: () => { db.writes.push(`delete:${table}`); return chain; },
      };
    },
  },
}));

const input = {
  streamId: "stream", occurrenceDate: "2026-04-15", ledgerBucket: "personal" as const,
  label: "Acme", sourceId: "co", incomeType: "w2_paycheck", grossAmount: 1000,
  taxesWithheld: 100, preTaxDeductions: 0, retirement401k: 0, healthcareDeduction: 0,
  hsaContribution: 0, federalWithholding: 100, stateWithholding: 0,
  ssWithholding: 0, medicareWithholding: 0, isBonus: false,
};
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useManualPlannerConvert(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  }).result;
}
beforeEach(() => {
  db.periods = [{ id: "closure", company_id: "co", closed_on: "2026-04-01", reopened_on: null }];
  db.failure = false; db.companyFailure = false; db.conversions = []; db.writes = [];
  db.income = [{ id: "historical", paycheck_amount: 1234 }];
});
describe("manual conversion closure guard on the real mutation", () => {
  it("rejects a closed occurrence before any write and preserves saved history", async () => {
    const historical = structuredClone(db.income);
    await expect(setup().current.mutateAsync(input)).rejects.toThrow("company closure period");
    expect(db.writes).toEqual([]);
    expect(db.income).toEqual(historical);
  });
  it("reopening does not allow a backdated closed occurrence, including legacy name matching", async () => {
    db.periods[0].reopened_on = "2026-04-20";
    await expect(setup().current.mutateAsync({ ...input, sourceId: null })).rejects.toThrow("company closure period");
    expect(db.writes).toEqual([]);
  });
  it("allows the first reopened day once and preserves historical income", async () => {
    db.periods[0].reopened_on = "2026-04-20";
    const result = setup();
    const eligible = { ...input, occurrenceDate: "2026-04-20" };
    expect(await result.current.mutateAsync(eligible)).toMatchObject({ alreadyExisted: false });
    expect(await result.current.mutateAsync(eligible)).toMatchObject({ alreadyExisted: true });
    expect(db.conversions).toHaveLength(1);
    expect(db.income).toHaveLength(2);
    expect(db.income[0]).toEqual({ id: "historical", paycheck_amount: 1234 });
    expect(db.writes.filter((w) => w === "insert:income_entries")).toHaveLength(1);
  });
  it("fails closed on closure lookup failure without any writes", async () => {
    db.failure = true;
    await expect(setup().current.mutateAsync(input)).rejects.toThrow("Nothing was converted");
    expect(db.writes).toEqual([]);
  });
  it("fails closed if legacy company lookup fails without any writes", async () => {
    db.companyFailure = true;
    await expect(setup().current.mutateAsync({ ...input, sourceId: null })).rejects.toThrow("Nothing was converted");
    expect(db.writes).toEqual([]);
  });
});