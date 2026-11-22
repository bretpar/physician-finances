import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useManualPlannerConvert } from "@/hooks/useProjectedIncome";

const state = vi.hoisted(() => ({ converted: false, inserts: [] as Array<{ table: string; payload: any }> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useOrgId", () => ({ getUserOrgId: async () => "org", useOrgId: () => ({ data: "org" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
  from: (table: string) => ({
    select: () => {
      const query: any = { eq: () => query, maybeSingle: async () => ({ data: table === "planner_conversions" && state.converted ? { id: "conversion" } : null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) };
      return query;
    },
    insert: (payload: any) => {
      state.inserts.push({ table, payload });
      if (table === "planner_conversions") state.converted = true;
      return { select: () => ({ single: async () => ({ data: { id: table === "planner_conversions" ? "conversion" : "income" }, error: null }) }) };
    },
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }),
} }));

describe("FSA manual conversion writes", () => {
  it("writes all three FSA values once and retries without a second entry", async () => {
    state.converted = false; state.inserts.length = 0;
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(useManualPlannerConvert, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    const input = { streamId: "stream", occurrenceDate: "2026-11-01", ledgerBucket: "personal" as const, label: "Employer", sourceId: "co", incomeType: "w2", grossAmount: 5000, taxesWithheld: 1000,
      preTaxDeductions: 375, fsaDeductions: { health: 100, dependent_care: 200, limited_purpose: 50 }, retirement401k: 0, healthcareDeduction: 0, hsaContribution: 0,
      federalWithholding: 1000, stateWithholding: 0, ssWithholding: 0, medicareWithholding: 0, isBonus: false };
    await result.current.mutateAsync(input);
    const retry = await result.current.mutateAsync(input);
    expect(retry.alreadyExisted).toBe(true);
    const rows = state.inserts.filter((r) => r.table === "income_entries");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ fsa_health: 100, fsa_dependent_care: 200, fsa_limited_purpose: 50, pre_tax_deductions: 375, deposited_amount: 3625 });
    expect(state.inserts.filter((r) => r.table === "planner_conversions")).toHaveLength(1);
  });
});