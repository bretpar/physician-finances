import { describe, expect, it } from "vitest";
import { buildReconciliationExport, reconciliationFileName } from "@/lib/taxReconciliationExport";

const base = {
  taxYear: 2026,
  generatedAt: new Date("2026-10-16T00:00:00Z"),
  timezone: "America/Los_Angeles",
  build: { commit: "abc" },
  selectedTaxMode: "actual",
};

describe("tax reconciliation export", () => {
  it("uses the required file name", () => {
    expect(reconciliationFileName(2026)).toBe("paycheckmd-tax-reconciliation-2026.json");
  });

  it("keeps IDs/links and drops non-allowlisted columns", () => {
    const out = buildReconciliationExport({
      ...base,
      datasets: {
        tax_payments: { status: "ok", rows: [{ id: "p1", payment_date: "2025-12-30", applied_tax_year: 2026, applied_quarter: 4, amount: 100, access_token: "x" }] },
        income_entries: { status: "ok", rows: [{ id: "e1", linked_transaction_id: "t1", origin_planner_conversion_id: "c1", date_of_birth: "1990-01-01" }] },
      },
      calculations: {},
    });
    const pay = (out.records.tax_payments as any[])[0];
    expect(pay).toEqual({ id: "p1", payment_date: "2025-12-30", applied_tax_year: 2026, applied_quarter: 4, amount: 100 });
    expect((out.records.income_entries as any[])[0]).toEqual({ id: "e1", linked_transaction_id: "t1", origin_planner_conversion_id: "c1" });
  });

  it("marks failed queries as errors, never as empty lists", () => {
    const out = buildReconciliationExport({
      ...base,
      datasets: { transactions: { status: "error", error: "boom" } },
      calculations: { actualOnlyDebug: null },
    });
    expect(out.records.transactions).toEqual({ error: "boom" });
    expect(out.metadata.recordCounts.transactions).toBeNull();
    expect(out.metadata.complete).toBe(false);
    expect(out.calculations.actualOnlyDebug).toEqual({ unavailable: true });
  });

  it("strips secret-looking keys from calculation outputs", () => {
    const out = buildReconciliationExport({
      ...base,
      datasets: {},
      calculations: { dbg: { taxableIncome: 5, nested: { plaid_access_token: "x", ok: 1 } } },
    });
    expect(out.calculations.dbg).toEqual({ taxableIncome: 5, nested: { ok: 1 } });
  });
});
