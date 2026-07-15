/**
 * Personal Income reportability regression suite.
 *
 * Covers the QA lifecycle for a Plaid-backed W-2 paycheck:
 *   Planner gross $10,000, Plaid deposit $6,485, Federal $1,500,
 *   SS $620, Medicare $145, 401(k) $800, Healthcare $300, HSA $100,
 *   Other pre-tax $50.
 *
 * The shared rule under test: src/lib/personalIncomeReportability.ts
 *   - Planner/manual/payroll row (status active) → reportable
 *   - Imported cash-confirmation row while merged → NOT reportable
 *   - Imported cash-confirmation row after unlink (include_in_tax_estimate=false)
 *     → NOT separately reportable
 *   - Standalone imported Plaid row (never linked) → reportable
 *   - Suggested-match canonical row → reportable
 */
import { describe, it, expect } from "vitest";
import { isPersonalIncomeReportable } from "@/lib/personalIncomeReportability";

const PLANNER = {
  id: "planner-1",
  status: "received",
  include_in_tax_estimate: true,
  gross_amount: 10000,
  federal_withholding: 1500,
  ss_withholding: 620,
  medicare_withholding: 145,
  retirement_401k: 800,
  healthcare_deduction: 300,
  hsa_contribution: 100,
  pre_tax_deductions: 50,
} as any;

const IMPORTED_ACTIVE = {
  id: "imp-1",
  status: "received",
  include_in_tax_estimate: true,
  gross_amount: 6485,
  deposited_amount: 6485,
  linked_transaction_id: "plaid-tx-1",
} as any;

const IMPORTED_MERGED = { ...IMPORTED_ACTIVE, status: "merged" };
const IMPORTED_UNLINKED_SHADOW = {
  ...IMPORTED_ACTIVE,
  status: "received",
  include_in_tax_estimate: false,
  include_in_cash_flow: false,
};

function sumReportable(rows: any[]) {
  return rows
    .filter((r) => isPersonalIncomeReportable(r))
    .reduce((s, r) => s + Number(r.gross_amount || 0), 0);
}

describe("personal income reportability lifecycle", () => {
  it("before link: planner + imported both reportable (standalone imports = $16,485)", () => {
    // Pre-link the imported row is NOT yet a shadow of the planner row.
    expect(sumReportable([PLANNER, IMPORTED_ACTIVE])).toBe(16485);
  });

  it("after link: planner reportable, imported merged, total = $10,000", () => {
    expect(sumReportable([PLANNER, IMPORTED_MERGED])).toBe(10000);
    expect(isPersonalIncomeReportable(PLANNER)).toBe(true);
    expect(isPersonalIncomeReportable(IMPORTED_MERGED)).toBe(false);
  });

  it("after unlink dissolve: shadow rule keeps total at $10,000 (NOT $16,485)", () => {
    expect(sumReportable([PLANNER, IMPORTED_UNLINKED_SHADOW])).toBe(10000);
    expect(isPersonalIncomeReportable(IMPORTED_UNLINKED_SHADOW)).toBe(false);
    // Imported row is still visible (status='received') for the linking UI.
    expect(IMPORTED_UNLINKED_SHADOW.status).toBe("received");
    // And retains its Plaid provenance for relink.
    expect(IMPORTED_UNLINKED_SHADOW.linked_transaction_id).toBe("plaid-tx-1");
    expect(IMPORTED_UNLINKED_SHADOW.deposited_amount).toBe(6485);
  });

  it("after relink: back to $10,000 (imported flipped to merged again)", () => {
    // Simulate relink outcome — link mutation flips imported back to merged
    // and sets include_in_tax_estimate=true (so future unlink starts clean).
    const relinkedImported = {
      ...IMPORTED_UNLINKED_SHADOW,
      status: "merged",
      include_in_tax_estimate: true,
    };
    expect(sumReportable([PLANNER, relinkedImported])).toBe(10000);
  });

  it("repeated unlink/relink shows no drift", () => {
    let imported = { ...IMPORTED_ACTIVE };
    for (let i = 0; i < 5; i++) {
      // link
      imported = { ...imported, status: "merged", include_in_tax_estimate: true };
      expect(sumReportable([PLANNER, imported])).toBe(10000);
      // unlink → imported shadow
      imported = {
        ...imported,
        status: "received",
        include_in_tax_estimate: false,
        include_in_cash_flow: false,
      };
      expect(sumReportable([PLANNER, imported])).toBe(10000);
    }
  });

  it("standalone Plaid import (never linked) remains reportable as $6,485", () => {
    // A standalone import never has include_in_tax_estimate flipped off.
    expect(sumReportable([IMPORTED_ACTIVE])).toBe(6485);
  });

  it("suggested planner-match canonical row is reportable as $10,000; no separate raw Plaid count", () => {
    // Suggested-match writes back into the planner row (canonical) — the raw
    // Plaid row becomes a merged sibling. Same lifecycle rule.
    const canonical = { ...PLANNER, deposited_amount: 6485 };
    expect(sumReportable([canonical, IMPORTED_MERGED])).toBe(10000);
  });

  it("deleted/unlinked statuses are not reportable", () => {
    expect(isPersonalIncomeReportable({ status: "deleted" } as any)).toBe(false);
    expect(isPersonalIncomeReportable({ status: "unlinked" } as any)).toBe(false);
    expect(isPersonalIncomeReportable({ status: "merged" } as any)).toBe(false);
  });
});
