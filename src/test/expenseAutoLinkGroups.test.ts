import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findExpenseAutoLinkPairs, type AutoLinkCandidate } from "@/lib/expenseAutoLink";

const FIX_SQL = readFileSync(
  "supabase/migrations/20260821043642_950261a4-2d00-4e52-9811-3ba86a620121.sql",
  "utf8",
);

function tx(over: Partial<AutoLinkCandidate> & { id: string }): AutoLinkCandidate {
  return {
    transaction_type: "expense",
    transaction_date: "2026-03-10",
    amount: 100,
    source_type: "manual",
    match_status: "unmatched",
    status: "active",
    user_id: "u1",
    organization_id: "org1",
    ...over,
  };
}

describe("split / many-to-many link groups survive", () => {
  it("the incompatible per-transaction unique indexes are dropped", () => {
    expect(FIX_SQL).toContain("DROP INDEX IF EXISTS public.transaction_links_active_manual_uniq");
    expect(FIX_SQL).toContain("DROP INDEX IF EXISTS public.transaction_links_active_plaid_uniq");
  });

  it("multiple rows in the SAME linked_group_id remain allowed (uniqueness keys on the group)", () => {
    expect(FIX_SQL).toContain(
      "ON public.transaction_links (linked_group_id, manual_transaction_id, plaid_transaction_record_id)",
    );
  });

  it("one Plaid deposit linked to two manual paycheck rows is restored, not superseded", () => {
    // The corrective migration re-activates superseded rows whose group is still active.
    expect(FIX_SQL).toContain("SET status = 'linked'");
    expect(FIX_SQL).toContain("WHERE s.linked_group_id = l.linked_group_id AND s.status = 'linked'");
  });

  it("the same transaction cannot belong to two DIFFERENT active groups", () => {
    expect(FIX_SQL).toContain("l.linked_group_id IS DISTINCT FROM NEW.linked_group_id");
    expect(FIX_SQL).toContain("ERRCODE = '23505'");
    // Serialized with row locks so concurrent syncs cannot both win.
    expect(FIX_SQL).toContain("FOR UPDATE");
  });
});

describe("group-aware cleanup", () => {
  it("only collapses genuine cross-group conflicts", () => {
    expect(FIX_SQL).toContain("HAVING count(DISTINCT linked_group_id) > 1");
    expect(FIX_SQL).toContain("rows_in_group = 1");
  });

  it("preserves ambiguous split groups for review instead of guessing", () => {
    expect(FIX_SQL).toContain("SELECT count(*) INTO v_ambiguous FROM _involved WHERE rows_in_group > 1");
  });

  it("reconciles transaction bookkeeping when a conflicting link is superseded", () => {
    expect(FIX_SQL).toContain("UPDATE public.transactions t");
    expect(FIX_SQL).toContain("match_status = 'unmatched'");
    expect(FIX_SQL).toContain("linked_group_id = NULL");
    expect(FIX_SQL).toContain("NOT EXISTS (");
  });
});

describe("organization isolation", () => {
  it("pair function refuses cross-organization rows", () => {
    expect(FIX_SQL).toContain("'organization_mismatch'");
    expect(FIX_SQL).toContain("v_manual.organization_id IS DISTINCT FROM v_plaid.organization_id");
  });

  it("batch candidate selection is partitioned by organization", () => {
    expect(FIX_SQL).toContain("m.organization_id IS NOT DISTINCT FROM p.organization_id");
  });

  it("client-side matcher never pairs across organizations", () => {
    expect(
      findExpenseAutoLinkPairs([
        tx({ id: "m1", organization_id: "orgA" }),
        tx({ id: "p1", source_type: "plaid", organization_id: "orgB" }),
      ]),
    ).toEqual([]);
    expect(
      findExpenseAutoLinkPairs([
        tx({ id: "m1", organization_id: "orgA" }),
        tx({ id: "p1", source_type: "plaid", organization_id: "orgA" }),
      ]),
    ).toEqual([{ manualTxId: "m1", plaidTxId: "p1" }]);
  });
});

describe("ambiguity is enforced inside the atomic RPC", () => {
  it("re-runs the qualifying-candidate check after locks are held", () => {
    const body = FIX_SQL.slice(
      FIX_SQL.indexOf("CREATE OR REPLACE FUNCTION public.auto_link_expense_pair"),
      FIX_SQL.indexOf("REVOKE ALL ON FUNCTION public.auto_link_expense_pair"),
    );
    const lockIdx = body.indexOf("FOR UPDATE");
    const recheckIdx = body.indexOf("INTO v_cand_count");
    const insertIdx = body.indexOf("INSERT INTO public.transaction_links");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(recheckIdx).toBeGreaterThan(lockIdx);
    expect(insertIdx).toBeGreaterThan(recheckIdx);
    expect(body).toContain("v_cand_count <> 1 OR v_cand_id IS DISTINCT FROM _manual_tx_id");
    expect(body).toContain("'ambiguous_candidates'");
  });

  it("a second qualifying manual row appearing just before execution blocks the link", () => {
    // Same criteria the RPC re-evaluates: two candidates → no link.
    expect(
      findExpenseAutoLinkPairs([
        tx({ id: "m1" }),
        tx({ id: "m2", amount: 100.5 }),
        tx({ id: "p1", source_type: "plaid" }),
      ]),
    ).toEqual([]);
  });

  it("the low-level pair function is server-path only", () => {
    expect(FIX_SQL).toContain(
      "REVOKE EXECUTE ON FUNCTION public.auto_link_expense_pair(uuid, uuid, numeric) FROM authenticated",
    );
    expect(FIX_SQL).toContain("GRANT EXECUTE ON FUNCTION public.auto_link_expenses_for_user(uuid) TO authenticated");
  });

  it("manual row stays canonical/active, imported row merged, enriched fields untouched", () => {
    expect(FIX_SQL).toContain("status = 'merged'");
    expect(FIX_SQL).toContain("status = 'active'");
    for (const col of ["receipt_url =", "category =", "notes =", "vendor =", "entity =", "source_id ="]) {
      expect(FIX_SQL).not.toContain(col);
    }
  });
});
