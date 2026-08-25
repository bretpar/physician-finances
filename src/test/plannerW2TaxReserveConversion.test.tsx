/**
 * Regression: Income Planner W-2 → Personal Income conversion must preserve the
 * user's saved-for-taxes amount in income_entries.additional_tax_reserve so it
 * counts as "Saved" (not "Paid") in the quarterly tracker.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

type Op = { kind: "insert" | "update"; table: string; payload: any; filters?: Record<string, any> };

const ops: Op[] = [];

let mirrorRow: { id: string } | null = null;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isLoading: false }),
}));

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
          single: async () => ({ data: null, error: null }),
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

async function convertW2Personal(additionalTaxReserve: number) {
  const { useManualPlannerConvert } = await import("@/hooks/useProjectedIncome");
  const { result } = renderHook(() => useManualPlannerConvert(), { wrapper });
  await result.current.mutateAsync({
    streamId: "s-2",
    bonusEventId: null,
    occurrenceDate: "2026-08-14",
    ledgerBucket: "personal",
    label: "Optum",
    sourceId: "co-optum",
    incomeType: "w2_paycheck",
    grossAmount: 10_000,
    taxesWithheld: 2_265,
    preTaxDeductions: 50,
    retirement401k: 800,
    healthcareDeduction: 300,
    hsaContribution: 100,
    federalWithholding: 1_500,
    stateWithholding: 0,
    ssWithholding: 620,
    medicareWithholding: 145,
    additionalTaxReserve: additionalTaxReserve,
    hasDetailedBreakdown: true,
    existingTransactionId: null,
    isBonus: false,
  } as any);
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
}

beforeEach(() => {
  ops.length = 0;
  mirrorRow = null;
});

describe("Planner W-2 → Personal Income tax reserve preservation", () => {
  it("persists additional_tax_reserve = 275 on the converted income_entries row", async () => {
    await convertW2Personal(275);

    const ieInserts = ops.filter((o) => o.kind === "insert" && o.table === "income_entries");
    expect(ieInserts).toHaveLength(1);
    expect(ieInserts[0].payload.additional_tax_reserve).toBe(275);

    // Payroll withholding (federal/state/SS/Medicare) must remain Paid, not Saved.
    expect(ieInserts[0].payload.federal_withholding).toBe(1_500);
    expect(ieInserts[0].payload.ss_withholding).toBe(620);
    expect(ieInserts[0].payload.medicare_withholding).toBe(145);
    expect(ieInserts[0].payload.taxes_withheld).toBe(2_265);
  });

  it("counts the preserved reserve as Saved in the quarterly recommendation", async () => {
    await convertW2Personal(275);

    const ieInsert = ops.find((o) => o.kind === "insert" && o.table === "income_entries");
    const incomeEntry = {
      id: "ie-new",
      user_id: "user-1",
      organization_id: "org-1",
      income_date: "2026-08-14",
      income_type: "w2_paycheck",
      source_bucket: "personal",
      ...ieInsert!.payload,
    };

    const recommendation = buildQuarterRecommendation({
      annualTaxLiability: 60_000,
      year: 2026,
      quarter: 3,
      quarterMethod: "dynamic",
      incomeEntries: [incomeEntry],
      personalEntries: [],
      transactions: [],
      investmentEntries: [],
      payments: [],
      manualSavings: [],
      projectedPaychecks: [],
      now: new Date(2026, 7, 15, 12, 0, 0),
    });

    const w2Row = recommendation.sourceRows.find((s: any) => s.key === "w2:source:co-optum");
    expect(w2Row).toBeTruthy();
    expect(w2Row!.saved).toBe(275);
    expect(w2Row!.paid).toBe(2_265);
  });
});
