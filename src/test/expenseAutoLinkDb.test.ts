// @vitest-environment node
/**
 * Executable Postgres regression coverage for the expense auto-link database
 * layer (advisory-lock ambiguity protection, cluster-scoped cleanup,
 * bookkeeping realignment, safe migration restoration).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  makeDb,
  insertTx,
  linkRow,
  pair,
  batch,
  cleanup,
  tx,
  activeGroupsFor,
  USER,
  ORG_A,
  ORG_B,
  FIX_MIGRATION,
} from "./helpers/expenseAutoLinkDb";

let db: Awaited<ReturnType<typeof makeDb>>;

beforeEach(async () => {
  db = await makeDb();
});
afterEach(async () => {
  await db.close();
});

async function withoutGroupTrigger(fn: () => Promise<void>) {
  await db.exec("ALTER TABLE public.transaction_links DISABLE TRIGGER transaction_links_single_active_group");
  try {
    await fn();
  } finally {
    await db.exec("ALTER TABLE public.transaction_links ENABLE TRIGGER transaction_links_single_active_group");
  }
}

const G = (n: number) => `cccccccc-0000-0000-0000-00000000000${n}`;

describe("unrelated expense auto-link behavior still passes", () => {
  it("links a single unambiguous pair within 1% / 2 days", async () => {
    const m = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const p = await insertTx(db, { date: "2026-03-12", amount: 101, source: "plaid" });
    const res = await pair(db, m, p);
    expect(res.linked).toBe(true);
    expect((await tx(db, m)).status).toBe("active");
    expect((await tx(db, p)).status).toBe("merged");
    expect((await tx(db, m)).linked_group_id).toBe(res.linked_group_id);
  });

  it("rejects >1% drift, >2 days and cross-organization pairs", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const p1 = await insertTx(db, { date: "2026-03-10", amount: 101.01, source: "plaid" });
    expect((await pair(db, m1, p1)).reason).toBe("amount_out_of_range");

    const m2 = await insertTx(db, { date: "2026-04-10", amount: 50 });
    const p2 = await insertTx(db, { date: "2026-04-13", amount: 50, source: "plaid" });
    expect((await pair(db, m2, p2)).reason).toBe("date_out_of_range");

    const m3 = await insertTx(db, { date: "2026-05-10", amount: 70, org: ORG_A });
    const p3 = await insertTx(db, { date: "2026-05-10", amount: 70, source: "plaid", org: ORG_B });
    expect((await pair(db, m3, p3)).reason).toBe("organization_mismatch");
  });

  it("batch pass links only unambiguous pairs", async () => {
    await insertTx(db, { date: "2026-06-01", amount: 200 });
    await insertTx(db, { date: "2026-06-01", amount: 200, source: "plaid" });
    await insertTx(db, { date: "2026-07-01", amount: 300 });
    await insertTx(db, { date: "2026-07-01", amount: 300.5 });
    await insertTx(db, { date: "2026-07-01", amount: 300, source: "plaid" });
    const res = await batch(db);
    expect(res.linked).toBe(1);
  });
});

describe("candidate inserted after the initial scan", () => {
  it("is blocked as ambiguous_candidates and links neither row", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });

    // Initial scan: exactly one candidate (what the batch pass would select).
    const scan = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.transactions
        WHERE source_type = 'manual' AND status = 'active' AND linked_group_id IS NULL`,
    );
    expect(scan.rows[0].n).toBe(1);

    // A second qualifying manual expense arrives before the link executes.
    const m2 = await insertTx(db, { date: "2026-03-11", amount: 100.5 });

    const res = await pair(db, m1, p);
    expect(res.linked).toBe(false);
    expect(res.reason).toBe("ambiguous_candidates");
    for (const id of [m1, m2, p]) {
      const row = await tx(db, id);
      expect(row.linked_group_id).toBeNull();
      expect(row.match_status).toBe("unmatched");
    }
    const links = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.transaction_links`);
    expect(links.rows[0].n).toBe(0);
  });

  it("serializes candidate creation with the auto-link scope lock", async () => {
    const trig = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger
        WHERE tgname = 'transactions_serialize_expense_autolink' AND NOT tgisinternal`,
    );
    expect(trig.rows[0].n).toBe(1);
  });
});

describe("bookkeeping realignment after cleanup", () => {
  it("re-points a transaction from a superseded group to the surviving group", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const m2 = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });

    await withoutGroupTrigger(async () => {
      await linkRow(db, { group: G(1), manual: m1, plaid: p, linkedAt: "2026-03-11T00:00:00Z" });
      await linkRow(db, { group: G(2), manual: m2, plaid: p, linkedAt: "2026-03-12T00:00:00Z" });
    });

    const res = await cleanup(db);
    expect(res.superseded).toBeGreaterThan(0);

    const groups = await activeGroupsFor(db, p);
    expect(groups).toEqual([G(2)]);

    const plaidRow = await tx(db, p);
    expect(plaidRow.linked_group_id).toBe(G(2));
    expect(plaidRow.match_status).toBe("linked");
    expect(plaidRow.status).toBe("merged");

    // The loser's manual row keeps no stale pointer.
    const loser = await tx(db, m1);
    expect(loser.linked_group_id).toBeNull();
    expect(loser.match_status).toBe("unmatched");
    expect(loser.status).toBe("active");

    // Survivor's manual row stays canonical and active.
    const winner = await tx(db, m2);
    expect(winner.linked_group_id).toBe(G(2));
    expect(winner.status).toBe("active");
  });

  it("never leaves a transaction pointing at a superseded group", async () => {
    const m = await insertTx(db, { date: "2026-03-10", amount: 100 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    await withoutGroupTrigger(async () => {
      await linkRow(db, { group: G(3), manual: m, plaid: p, status: "superseded" });
    });
    await cleanup(db);
    for (const id of [m, p]) {
      expect((await tx(db, id)).linked_group_id).toBeNull();
      expect((await tx(db, id)).match_status).toBe("unmatched");
    }
  });
});

describe("conflicts are resolved per connected cluster", () => {
  it("yields exactly one survivor per independent cluster", async () => {
    const a1 = await insertTx(db, { date: "2026-03-10", amount: 10 });
    const a2 = await insertTx(db, { date: "2026-03-10", amount: 10 });
    const ap = await insertTx(db, { date: "2026-03-10", amount: 10, source: "plaid" });
    const b1 = await insertTx(db, { date: "2026-05-10", amount: 20 });
    const b2 = await insertTx(db, { date: "2026-05-10", amount: 20 });
    const bp = await insertTx(db, { date: "2026-05-10", amount: 20, source: "plaid" });

    await withoutGroupTrigger(async () => {
      await linkRow(db, { group: G(4), manual: a1, plaid: ap, linkedAt: "2026-03-11T00:00:00Z" });
      await linkRow(db, { group: G(5), manual: a2, plaid: ap, linkedAt: "2026-03-12T00:00:00Z" });
      await linkRow(db, { group: G(6), manual: b1, plaid: bp, linkedAt: "2026-05-11T00:00:00Z" });
      await linkRow(db, { group: G(7), manual: b2, plaid: bp, linkedAt: "2026-05-12T00:00:00Z" });
    });

    const res = await cleanup(db);
    expect(res.clusters).toBe(2);

    expect(await activeGroupsFor(db, ap)).toEqual([G(5)]);
    expect(await activeGroupsFor(db, bp)).toEqual([G(7)]);
    // Losers of one cluster never affect the other cluster's survivor.
    expect(await activeGroupsFor(db, a2)).toEqual([G(5)]);
    expect(await activeGroupsFor(db, b2)).toEqual([G(7)]);
    expect(await activeGroupsFor(db, a1)).toEqual([]);
    expect(await activeGroupsFor(db, b1)).toEqual([]);
  });

  it("leaves ambiguous split clusters untouched for review", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 60 });
    const m2 = await insertTx(db, { date: "2026-03-10", amount: 40 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    const other = await insertTx(db, { date: "2026-03-10", amount: 100 });

    await withoutGroupTrigger(async () => {
      // A legitimate split group (one deposit ↔ two manual rows) …
      await linkRow(db, { group: G(8), manual: m1, plaid: p, linkedAt: "2026-03-11T00:00:00Z" });
      await linkRow(db, { group: G(8), manual: m2, plaid: p, linkedAt: "2026-03-11T00:00:00Z" });
      // … drawn into a conflict by a competing single-row group.
      await linkRow(db, { group: G(9), manual: other, plaid: p, linkedAt: "2026-03-12T00:00:00Z" });
    });

    const res = await cleanup(db);
    expect(res.ambiguous).toBe(1);
    expect(res.superseded).toBe(0);
    const groups = (await activeGroupsFor(db, p)).sort();
    expect(groups).toEqual([G(8), G(9)]);
  });
});

describe("legitimate split group remains valid", () => {
  it("cleanup keeps both rows of a non-conflicting split group linked", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 60 });
    const m2 = await insertTx(db, { date: "2026-03-10", amount: 40 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    await withoutGroupTrigger(async () => {
      await linkRow(db, { group: G(1), manual: m1, plaid: p });
      await linkRow(db, { group: G(1), manual: m2, plaid: p });
    });

    const res = await cleanup(db);
    expect(res.superseded).toBe(0);
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.transaction_links WHERE status = 'linked' AND linked_group_id = $1`,
      [G(1)],
    );
    expect(rows.rows[0].n).toBe(2);
    expect((await tx(db, m1)).linked_group_id).toBe(G(1));
    expect((await tx(db, m2)).linked_group_id).toBe(G(1));
    expect((await tx(db, p)).status).toBe("merged");
  });

  it("the same transaction still cannot join two different active groups", async () => {
    const m = await insertTx(db, { date: "2026-03-10", amount: 10 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 10, source: "plaid" });
    await linkRow(db, { group: G(1), manual: m, plaid: p });
    await expect(linkRow(db, { group: G(2), manual: m, plaid: p })).rejects.toThrow();
  });
});

describe("migration restoration is conflict-safe", () => {
  it("does not restore a superseded row when it would create a cross-group conflict", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 60 });
    const m2 = await insertTx(db, { date: "2026-03-10", amount: 40 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    const otherM = await insertTx(db, { date: "2026-03-10", amount: 100 });

    await withoutGroupTrigger(async () => {
      await linkRow(db, { group: G(1), manual: m1, plaid: p });
      // Superseded split sibling in the same (still active) group …
      await linkRow(db, { group: G(1), manual: m2, plaid: p, status: "superseded" });
      // … while m2 is already active in a different group.
      await linkRow(db, { group: G(2), manual: m2, plaid: otherM });
    });

    // Re-run the corrective migration (restoration + reconciliation).
    await db.exec(readFileSync(FIX_MIGRATION, "utf8"));

    const restored = await db.query<{ status: string }>(
      `SELECT status FROM public.transaction_links
        WHERE linked_group_id = $1 AND manual_transaction_id = $2`,
      [G(1), m2],
    );
    expect(restored.rows[0].status).toBe("superseded");

    // Reconciliation guarantee: nobody is active in two groups.
    const dup = await db.query<{ n: number }>(
      `WITH claims AS (
         SELECT linked_group_id, manual_transaction_id AS tx FROM public.transaction_links WHERE status = 'linked'
         UNION ALL
         SELECT linked_group_id, plaid_transaction_record_id FROM public.transaction_links WHERE status = 'linked'
       )
       SELECT count(*)::int AS n FROM (
         SELECT tx FROM claims WHERE tx IS NOT NULL GROUP BY tx HAVING count(DISTINCT linked_group_id) > 1
       ) q`,
    );
    expect(dup.rows[0].n).toBe(0);
  });

  it("restores a safe superseded split row", async () => {
    const m1 = await insertTx(db, { date: "2026-03-10", amount: 60 });
    const m2 = await insertTx(db, { date: "2026-03-10", amount: 40 });
    const p = await insertTx(db, { date: "2026-03-10", amount: 100, source: "plaid" });
    await withoutGroupTrigger(async () => {
      await linkRow(db, { group: G(1), manual: m1, plaid: p });
      await linkRow(db, { group: G(1), manual: m2, plaid: p, status: "superseded" });
    });

    await db.exec(readFileSync(FIX_MIGRATION, "utf8"));

    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.transaction_links WHERE status = 'linked' AND linked_group_id = $1`,
      [G(1)],
    );
    expect(rows.rows[0].n).toBe(2);
    expect(USER).toBeTruthy();
  });
});
