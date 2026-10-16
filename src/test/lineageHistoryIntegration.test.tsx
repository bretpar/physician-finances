/**
 * Integration: the real useTaxEstimate data-loading path. The fake backend
 * applies query filters (so useTransactions() really returns only
 * status=active rows) and the hook must still see merged lineage through the
 * read-only history query. Shape mirrors the real Vituity groups (anonymized):
 * active imported deposit, merged gross-pay parent, stranded gross entry with
 * deductions, and an imported income mirror of the deposit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const SRC = "co-k1";
const DATE = "2026-02-17";
const db: Record<string, any[]> = {};

function seed(confirmed: boolean) {
  db.transactions = [
    { id: "dep", transaction_type: "income", status: "active", source_type: "plaid", linked_group_id: "g1", amount: 14542.98, transaction_date: DATE, source_id: SRC, entity: "K1Co", company_type: "k1_partnership", vendor: "PAYROLL", category: "Income", match_status: "linked", excluded_from_reports: false, created_at: DATE },
    { id: "parent", transaction_type: "income", status: "merged", source_type: "manual", linked_group_id: "g1", amount: 17770, transaction_date: DATE, source_id: SRC, entity: "K1Co", company_type: "k1_partnership", vendor: "January shifts", category: "Income", match_status: "linked", excluded_from_reports: false, created_at: DATE },
  ];
  const base = { company: "K1Co", income_type: "k1", status: "received", income_date: DATE, source_id: SRC, gross_amount: 0, pre_tax_deductions: 0, taxes_withheld: 0, federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0, hsa_contribution: 0, is_actual: true, include_in_tax_estimate: true, source_bucket: "business", created_at: DATE, updated_at: DATE };
  db.income_entries = [
    { ...base, id: "mirror", linked_transaction_id: "dep", paycheck_amount: 14542.98, deposited_amount: 0, retirement_401k: 0, employer_retirement_contribution: 0, healthcare_deduction: 0 },
    { ...base, id: "stub", linked_transaction_id: "parent", paycheck_amount: 17770, deposited_amount: 14542, retirement_401k: 181.25, employer_retirement_contribution: 351.85, healthcare_deduction: 2493 },
  ];
  db.transaction_links = [{ id: "l1", linked_group_id: "g1", manual_transaction_id: "dep", plaid_transaction_record_id: "parent", status: "linked" }];
  db.income_entry_links = [];
  db.link_review_dismissals = confirmed ? [{ item_key: "lineage-confirm:g1" }] : [];
}

function builder(table: string) {
  const filters: Array<(r: any) => boolean> = [];
  let single = false;
  const run = () => {
    const rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    return { data: single ? rows[0] ?? null : rows, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b, range: () => b,
    eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
    neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), b),
    in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), b),
    is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), b),
    gte: (c: string, v: any) => (filters.push((r) => r[c] == null || r[c] >= v), b),
    lte: (c: string, v: any) => (filters.push((r) => r[c] == null || r[c] <= v), b),
    lt: (c: string, v: any) => (filters.push((r) => r[c] == null || r[c] < v), b),
    gt: (c: string, v: any) => (filters.push((r) => r[c] == null || r[c] > v), b),
    like: (c: string, p: string) => (filters.push((r) => String(r[c] ?? "").startsWith(p.replace(/%$/, ""))), b),
    or: () => b, not: () => b, filter: () => b,
    maybeSingle: () => ((single = true), Promise.resolve(run())),
    single: () => ((single = true), Promise.resolve(run())),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (t: string) => builder(t),
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  },
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompanies: () => ({ companies: [{ id: SRC, name: "K1Co", company_type: "k1_partnership", include_in_tax: true, apply_business_state_tax: false, advanced_field_visibility: {} }] }),
}));
vi.mock("@/hooks/useFeatureAccess", () => ({ useFeatureAccess: () => ({ accessStatus: () => "allowed" }) }));

import { useTaxEstimate } from "@/hooks/useTaxEstimate";

async function load(confirmed: boolean) {
  seed(confirmed);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useTaxEstimate(), { wrapper });
  await waitFor(() => expect(result.current.mergeLineageFindings.length).toBe(1), { timeout: 5000 });
  await waitFor(() => expect(result.current.canonicalInputs).not.toBeNull());
  return { result, qc };
}

describe("useTaxEstimate — merge lineage on the real loading path", () => {
  beforeEach(() => { for (const k of Object.keys(db)) delete db[k]; });

  it("pending: proposal is visible, deposit counted as-is, no link warnings for merged partners", async () => {
    const { result } = await load(false);
    const f = result.current.mergeLineageFindings[0];
    expect(f.status).toBe("proposed_pending_confirmation");
    expect(f.proposedMapping).toMatchObject({ gross: 17770, survivorDeposit: 14542.98, mirrorEntryId: "mirror" });
    const inp: any = result.current.canonicalInputs!.actualOnlyTaxInputs;
    expect(inp.businessIncome).toBeCloseTo(14542.98, 2);
    expect(inp.businessRetirement).toBe(0);
    expect(inp.ownerHealthcare).toBe(0);
    expect(result.current.linkIssues.filter((i) => i.kind !== "incomplete_metadata")).toEqual([]);
  });

  it("confirmed: gross counted once with its deductions once; merged parent never counted", async () => {
    const { result } = await load(true);
    expect(result.current.mergeLineageFindings[0].status).toBe("authoritative_gross_applied");
    const inp: any = result.current.canonicalInputs!.actualOnlyTaxInputs;
    expect(inp.businessIncome).toBeCloseTo(17770, 2);
    expect(inp.businessRetirement).toBeCloseTo(181.25 + 351.85, 2);
    expect(inp.ownerHealthcare).toBe(2493);
  });

  it("recalculates after confirmation is recorded", async () => {
    const { result, qc } = await load(false);
    expect((result.current.canonicalInputs!.actualOnlyTaxInputs as any).businessIncome).toBeCloseTo(14542.98, 2);
    db.link_review_dismissals = [{ item_key: "lineage-confirm:g1" }];
    await qc.invalidateQueries({ queryKey: ["link-review-dismissals"] });
    await waitFor(() => expect((result.current.canonicalInputs!.actualOnlyTaxInputs as any).businessIncome).toBeCloseTo(17770, 2));
    expect(db.transactions.find((t) => t.id === "dep").amount).toBe(14542.98); // records untouched
  });
});
