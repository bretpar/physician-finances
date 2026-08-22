// @vitest-environment node
/**
 * Executable Postgres coverage for stale/orphaned link-group repair.
 *
 * A link group is genuinely active only when it still contains ≥2 distinct live
 * transactions — the same rule as the frontend `computeLinkEligibility()`.
 * Stale groups must never block a new manual link; true active groups must.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { makeDb, insertTx, tx, activeGroupsFor, USER, ORG_A } from "./helpers/expenseAutoLinkDb";

const STALE_MIGRATION = "supabase/migrations/20260822171234_19db961c-0d75-4c46-bc30-48c0b46a2b2f.sql";

let db: Awaited<ReturnType<typeof makeDb>>;

beforeEach(async () => {
  db = await makeDb();
  await db.exec(readFileSync(STALE_MIGRATION, "utf8"));
});
afterEach(async () => {
  await db.close();
});

const G = (n: number) => `dddddddd-0000-0000-0000-00000000000${n}`;

async function rawLink(
  args: { group: string; manual: string | null; plaid: string | null; status?: string },
) {
  await db.query(
    `INSERT INTO public.transaction_links
       (user_id, organization_id, linked_group_id, manual_transaction_id, plaid_transaction_record_id, status, created_by_user)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'linked'), true)`,
    [USER, ORG_A, args.group, args.manual, args.plaid, args.status ?? null],
  );
}

async function markLinked(id: string, group: string, status = "active") {
  await db.query(
    `UPDATE public.transactions SET match_status = 'linked', linked_group_id = $1, status = $3 WHERE id = $2`,
    [group, id, status],
  );
}

async function repair(ids: string[]) {
  const res = await db.query<{ r: any }>(
    `SELECT public.repair_stale_links_for_transactions($1::uuid[]) AS r`,
    [ids],
  );
  return res.rows[0].r as { groups_repaired: number; transactions_cleared: number };
}

describe("stale link-group repair", () => {
  it("transaction with an orphan (single-sided) link row can be linked again", async () => {
    const a = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const b = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    await rawLink({ group: G(1), manual: a, plaid: null });
    await markLinked(a, G(1));

    await rawLink({ group: G(2), manual: a, plaid: b });

    expect(await activeGroupsFor(db, a)).toEqual([G(2)]);
    const stale = await db.query<{ status: string }>(
      `SELECT status FROM public.transaction_links WHERE linked_group_id = $1`,
      [G(1)],
    );
    expect(stale.rows[0].status).toBe("superseded");
  });

  it("stale transactions.linked_group_id with no link rows is cleared and linking succeeds", async () => {
    const a = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const b = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    await markLinked(a, G(7));

    const res = await repair([a, b]);
    expect(res.transactions_cleared).toBe(1);
    expect((await tx(db, a)).linked_group_id).toBeNull();
    expect((await tx(db, a)).match_status).toBe("unmatched");

    await rawLink({ group: G(2), manual: a, plaid: b });
    expect(await activeGroupsFor(db, a)).toEqual([G(2)]);
  });

  it("single-sided group whose partner was deleted is cleaned and relinking succeeds", async () => {
    const a = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const gone = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    const fresh = await insertTx(db, { date: "2026-03-11", amount: 100, source: "plaid" });
    await rawLink({ group: G(3), manual: a, plaid: gone });
    await markLinked(a, G(3));
    await markLinked(gone, G(3), "merged");
    await db.query(`DELETE FROM public.transactions WHERE id = $1`, [gone]);

    const res = await repair([a, fresh]);
    expect(res.groups_repaired).toBe(1);
    expect((await tx(db, a)).linked_group_id).toBeNull();
    expect((await tx(db, a)).match_status).toBe("unmatched");
    expect((await tx(db, a)).status).toBe("active");

    await rawLink({ group: G(4), manual: a, plaid: fresh });
    expect(await activeGroupsFor(db, a)).toEqual([G(4)]);
  });

  it("true active two-transaction group still blocks joining a second group", async () => {
    const a = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const b = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    const c = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    await rawLink({ group: G(5), manual: a, plaid: b });
    await markLinked(a, G(5));
    await markLinked(b, G(5), "merged");

    await expect(rawLink({ group: G(6), manual: a, plaid: c })).rejects.toThrow(
      /already belongs to active link group/,
    );
    expect(await activeGroupsFor(db, a)).toEqual([G(5)]);
    expect((await tx(db, a)).linked_group_id).toBe(G(5));
  });

  it("repair does not remove valid split (many-to-many) groups", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 60 });
    const m2 = await insertTx(db, { date: "2026-03-10", amount: 40 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    await rawLink({ group: G(8), manual: m1, plaid: p });
    await rawLink({ group: G(8), manual: m2, plaid: p });
    await markLinked(m1, G(8));
    await markLinked(m2, G(8));
    await markLinked(p, G(8), "merged");

    const res = await repair([m1, m2, p]);
    expect(res.groups_repaired).toBe(0);
    expect(res.transactions_cleared).toBe(0);
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.transaction_links WHERE status = 'linked' AND linked_group_id = $1`,
      [G(8)],
    );
    expect(rows.rows[0].n).toBe(2);
    expect((await tx(db, p)).status).toBe("merged");
  });
});
