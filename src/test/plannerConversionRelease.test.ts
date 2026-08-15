/**
 * Regression coverage for the planner conversion lifecycle.
 *
 * Deleting a converted ledger row used to leave planner_conversions at
 * status 'converted' forever, so the occurrence stayed excluded from
 * projected totals while its actual row no longer existed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const updates: any[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (patch: any) => ({
        in: (col: string, ids: string[]) => {
          updates.push({ table, patch, col, ids });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

import { releasePlannerConversionsForLedgerRows } from "@/lib/plannerCleanup";

beforeEach(() => {
  updates.length = 0;
});

describe("releasePlannerConversionsForLedgerRows", () => {
  it("cancels conversions linked to deleted income entries", async () => {
    await releasePlannerConversionsForLedgerRows({ incomeEntryIds: ["ie-1"] });
    expect(updates).toEqual([
      {
        table: "planner_conversions",
        patch: expect.objectContaining({ status: "cancelled", income_entry_id: null }),
        col: "income_entry_id",
        ids: ["ie-1"],
      },
    ]);
  });

  it("cancels conversions linked to deleted transactions", async () => {
    await releasePlannerConversionsForLedgerRows({ transactionIds: ["tx-1", "tx-2"] });
    expect(updates).toHaveLength(1);
    expect(updates[0].col).toBe("transaction_id");
    expect(updates[0].patch.status).toBe("cancelled");
    expect(updates[0].patch.transaction_id).toBeNull();
  });

  it("no-ops when nothing was deleted", async () => {
    await releasePlannerConversionsForLedgerRows({});
    expect(updates).toHaveLength(0);
  });
});

describe("planner-aware delete paths", () => {
  it("every ledger delete path releases planner conversions", () => {
    for (const f of [
      "src/hooks/useTransactions.ts",
      "src/hooks/useIncome.ts",
      "src/hooks/usePersonalIncome.ts",
    ]) {
      expect(readFileSync(f, "utf8")).toContain("releasePlannerConversionsForLedgerRows");
    }
  });
});

describe("forecast headline reactivity", () => {
  it("keeps planner overrides and conversions in the tax-input memo deps", () => {
    const source = readFileSync("src/hooks/useTaxEstimate.ts", "utf8");
    const deps = source.match(/\}, \[rates, reconciledIncomeEntries[^\]]*\]\);/s);
    expect(deps).toBeTruthy();
    expect(deps![0]).toContain("overrides");
    expect(deps![0]).toContain("plannerConversions");
  });
});
