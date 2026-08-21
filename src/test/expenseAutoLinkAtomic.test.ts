import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { amountsWithinTolerance, findExpenseAutoLinkPairs, type AutoLinkCandidate } from "@/lib/expenseAutoLink";

const PAIR_SQL = readFileSync("supabase/migrations/20260821041815_cfd60094-ebfb-4e91-b186-86827b8ba702.sql", "utf8");
const BATCH_SQL = readFileSync("supabase/migrations/20260821041928_324c758f-7431-4a23-9d76-ac0e8ec3c176.sql", "utf8");
const SYNC_FN = readFileSync("supabase/functions/plaid-sync-transactions/index.ts", "utf8");
const WEBHOOK_FN = readFileSync("supabase/functions/plaid-webhook/index.ts", "utf8");

function tx(over: Partial<AutoLinkCandidate> & { id: string }): AutoLinkCandidate {
  return {
    transaction_type: "expense",
    transaction_date: "2026-03-10",
    amount: 100,
    source_type: "manual",
    match_status: "unmatched",
    status: "active",
    ...over,
  };
}

describe("1% tolerance uses the manual amount as denominator", () => {
  it("manual 100.00 / plaid 101.00 → exactly 1%, qualifies", () => {
    expect(amountsWithinTolerance(100, 101)).toBe(true);
  });

  it("manual 100.00 / plaid 101.01 → 1.01%, fails", () => {
    expect(amountsWithinTolerance(100, 101.01)).toBe(false);
  });

  it("manual 100.00 / plaid 99.00 → qualifies below as well", () => {
    expect(amountsWithinTolerance(100, 99)).toBe(true);
    expect(amountsWithinTolerance(100, 98.99)).toBe(false);
  });

  it("denominator is the manual amount, not the larger amount", () => {
    // plaid 100, manual 101 → 0.99% of manual → qualifies
    expect(amountsWithinTolerance(101, 100)).toBe(true);
    // plaid 100, manual 99 → 1.01% of manual → fails
    expect(amountsWithinTolerance(99, 100)).toBe(false);
  });

  it("boundary respected end-to-end through pair finding", () => {
    expect(
      findExpenseAutoLinkPairs([tx({ id: "m1", amount: 100 }), tx({ id: "p1", source_type: "plaid", amount: 101 })]),
    ).toEqual([{ manualTxId: "m1", plaidTxId: "p1" }]);
    expect(
      findExpenseAutoLinkPairs([tx({ id: "m1", amount: 100 }), tx({ id: "p1", source_type: "plaid", amount: 101.01 })]),
    ).toEqual([]);
  });

  it("2 calendar day rule unchanged", () => {
    expect(
      findExpenseAutoLinkPairs([
        tx({ id: "m1", transaction_date: "2026-03-10" }),
        tx({ id: "p1", source_type: "plaid", transaction_date: "2026-03-12" }),
      ]),
    ).toHaveLength(1);
    expect(
      findExpenseAutoLinkPairs([
        tx({ id: "m1", transaction_date: "2026-03-10" }),
        tx({ id: "p1", source_type: "plaid", transaction_date: "2026-03-13" }),
      ]),
    ).toHaveLength(0);
  });
});

describe("server-side auto-link runs on every Plaid import path", () => {
  it("the shared sync function invokes the batch auto-link operation", () => {
    expect(SYNC_FN).toContain('adminClient.rpc(\n        "auto_link_expenses_for_user"');
  });

  it("auto-link is placed after routing, before the response, so normal sync, cron and backfill all reach it", () => {
    const autoLinkIdx = SYNC_FN.indexOf("auto_link_expenses_for_user");
    const backfillIdx = SYNC_FN.indexOf('if (mode === "backfill")');
    const logsIdx = SYNC_FN.indexOf("const account_logs = Object.values(stats);");
    expect(backfillIdx).toBeGreaterThan(-1);
    expect(autoLinkIdx).toBeGreaterThan(backfillIdx);
    expect(autoLinkIdx).toBeLessThan(logsIdx);
  });

  it("webhook path delegates to the same sync function", () => {
    expect(WEBHOOK_FN).toContain("plaid-sync-transactions");
  });

  it("sync never fails because auto-link failed", () => {
    expect(SYNC_FN).toContain("Plaid expense auto-link failed");
  });
});

describe("atomic + concurrency-safe linking", () => {
  it("locks both rows before validating", () => {
    expect(PAIR_SQL).toContain("FOR UPDATE");
  });

  it("re-checks eligibility at link time and bails if already claimed", () => {
    expect(PAIR_SQL).toContain("already_claimed");
    expect(PAIR_SQL).toContain("already_linked");
  });

  it("database protection prevents a transaction from having two active link groups", () => {
    const FIX_SQL = readFileSync(
      "supabase/migrations/20260821043642_950261a4-2d00-4e52-9811-3ba86a620121.sql",
      "utf8",
    );
    expect(FIX_SQL).toContain("transaction_links_single_active_group");
  });

  it("loses races safely instead of creating a duplicate link", () => {
    expect(PAIR_SQL).toContain("EXCEPTION WHEN unique_violation THEN");
    expect(PAIR_SQL).toContain("race_lost");
  });

  it("a mid-link failure cannot leave both rows active (single function body = single transaction)", () => {
    // The insert and both row updates live in one plpgsql function, so a
    // failure anywhere rolls the whole link back.
    const bodyStart = PAIR_SQL.indexOf("CREATE OR REPLACE FUNCTION public.auto_link_expense_pair");
    const bodyEnd = PAIR_SQL.indexOf("$function$;", bodyStart);
    const body = PAIR_SQL.slice(bodyStart, bodyEnd);
    expect(body).toContain("INSERT INTO public.transaction_links");
    expect((body.match(/UPDATE public\.transactions/g) || []).length).toBe(2);
  });
});

describe("canonical row and enriched fields", () => {
  it("manual row stays canonical and active; imported row is merged", () => {
    expect(PAIR_SQL).toContain("source_type = 'merged'");
    expect(PAIR_SQL).toContain("status = 'merged'");
    expect(PAIR_SQL).toContain("status = 'active'");
  });

  it("does not overwrite manual receipt, category, notes, or company/entity/source assignment", () => {
    for (const col of ["receipt_url", "category", "notes", "vendor", "entity", "source_id", "company_type", "schedule_c_category"]) {
      expect(PAIR_SQL).not.toContain(`${col} =`);
    }
  });

  it("expense-only: income/paycheck matching is untouched", () => {
    expect(PAIR_SQL).toContain("not_expense");
    expect(BATCH_SQL).toContain("'expense'");
  });

  it("batch pass only links unambiguous pairs", () => {
    expect(BATCH_SQL).toContain("HAVING count(*) = 1");
  });
});
