import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { format, addDays } from "date-fns";
import { generateProjectedPaychecks, useManualPlannerConvert, type ProjectedIncomeStream } from "@/hooks/useProjectedIncome";

const state = vi.hoisted(() => ({ converted: false, inserts: [] as Array<{ table: string; payload: Record<string, unknown> }> }));
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
    insert: (payload: Record<string, unknown>) => {
      state.inserts.push({ table, payload });
      if (table === "planner_conversions") state.converted = true;
      return { select: () => ({ single: async () => ({ data: { id: table === "planner_conversions" ? "conversion" : "income" }, error: null }) }) };
    },
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }),
} }));

const date = format(new Date(), "yyyy-MM-dd");
const input = { streamId: "s1", occurrenceDate: date, ledgerBucket: "personal" as const, label: "Employer", sourceId: "co", incomeType: "w2", grossAmount: 10000, taxesWithheld: 0,
  preTaxDeductions: 0, retirement401k: 500, employerRetirementContribution: 250, employerMatchEstimated: true, employerRetirementReducesPaycheck: true, healthcareDeduction: 0, hsaContribution: 0,
  federalWithholding: 0, stateWithholding: 0, ssWithholding: 0, medicareWithholding: 0, isBonus: false };
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(useManualPlannerConvert, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => { state.converted = false; state.inserts.length = 0; });
describe("employer match conversion integrity", () => {
  it("leaves an estimate out of actual writes and conversion retries cannot duplicate it", async () => {
    const { result } = setup();
    await result.current.mutateAsync(input);
    expect((await result.current.mutateAsync(input)).alreadyExisted).toBe(true);
    const rows = state.inserts.filter((r) => r.table === "income_entries");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.employer_retirement_contribution).toBe(0);
    expect(rows[0].payload.deposited_amount).toBe(9500);
    expect(state.inserts.filter((r) => r.table === "planner_conversions")).toHaveLength(1);
  });
  it.each([250, 75, 0])("transfers confirmed/manual amount %i once", async (amount) => {
    const { result } = setup();
    const confirmed = { ...input, employerMatchEstimated: false, employerRetirementContribution: amount };
    await result.current.mutateAsync(confirmed);
    await result.current.mutateAsync(confirmed);
    const rows = state.inserts.filter((r) => r.table === "income_entries");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.employer_retirement_contribution).toBe(amount);
    expect(rows[0].payload.deposited_amount).toBe(9500 - amount);
  });
  it("converted actual and remaining active projections each contribute only once", () => {
    const next = format(addDays(new Date(), 14), "yyyy-MM-dd");
    const s = { id: "s1", company: "Employer", company_type: "w2", source_id: "co", start_date: date, end_date: next, pay_frequency: "custom", custom_interval_days: 14, paycheck_amount: 10000, retirement_401k: 500, taxes_withheld: 0, pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0, is_active: true, notes: "" } as ProjectedIncomeStream;
    const actual = { id: "income", income_date: date, company: "Employer", source_id: "co", paycheck_amount: 10000, income_type: "w2", status: "received", origin_planner_conversion_id: "conversion" };
    const paychecks = generateProjectedPaychecks([s], [], [actual], [], [{ stream_id: "s1", bonus_event_id: null, occurrence_date: date, status: "converted", income_entry_id: "income" }], [], undefined, null, { s1: { kind: "match", matchRate: 0.5, matchCapPct: 0.06 } });
    expect(paychecks.find((p) => p.date === date)?.matchStatus).not.toBe("active");
    const active = paychecks.filter((p) => p.matchStatus === "active");
    expect(active).toHaveLength(1);
    expect(active.reduce((sum, p) => sum + (p.employerRetirementContribution ?? 0), 75)).toBe(325);
  });
});