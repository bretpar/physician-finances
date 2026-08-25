// @vitest-environment node
/**
 * Native PostgreSQL concurrency suite for expense auto-linking.
 *
 * Runs against a REAL, disposable PostgreSQL server (PostgreSQL 18 in CI) with
 * independent `pg` connections — not PGlite, not mocks. The real app migrations
 * that define the auto-link layer are applied verbatim on top of a test-only
 * bootstrap schema that reproduces production grants and RLS.
 *
 * Skips (never fails) when `TEST_DATABASE_URL` / `NATIVE_PG_URL` is unset.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import {
  hasNativePg,
  provisionSchema,
  connect,
  truncateAll,
  seedOrgs,
  insertTx,
  pair,
  tx,
  activeLinks,
  backendPid,
  waitUntilBlockedOnAdvisoryLock,
  scopeLockKey,
  asServiceRoleForUser,
  serverVersion,
  USER_A,
  USER_B,
  ORG_A,
  ORG_B,
} from "./helpers/nativePg";

const d = hasNativePg ? describe : describe.skip;

/**
 * Refusal reasons that are safe by construction: each is returned BEFORE any
 * write, so the losing caller cannot mutate state.
 */
const SAFE_REFUSALS = ["already_claimed", "already_linked", "race_lost", "ambiguous_candidates", "wrong_sides"];

d("native PostgreSQL expense auto-link", () => {
  let a: Client; // primary / worker 1
  let b: Client; // worker 2 / racer
  let o: Client; // observer

  beforeAll(async () => {
    await provisionSchema();
    a = await connect();
    b = await connect();
    o = await connect();
    // eslint-disable-next-line no-console
    console.log("native PostgreSQL server_version:", await serverVersion(a));
  }, 60_000);

  afterAll(async () => {
    // CI always tears the disposable data down, even on failure.
    try {
      if (a) await truncateAll(a);
    } finally {
      await Promise.all([a?.end(), b?.end(), o?.end()].map((p) => Promise.resolve(p).catch(() => {})));
    }
  });

  beforeEach(async () => {
    await truncateAll(a);
    await seedOrgs(a);
  });

  // ── 1. Unambiguous pair ───────────────────────────────────────────────────
  describe("1. unambiguous pair", () => {
    it("links exactly once, manual stays canonical, imported row is merged", async () => {
      const m = await insertTx(a, { date: "2026-03-10", amount: 100 });
      const p = await insertTx(a, { date: "2026-03-12", amount: 101, source: "plaid" });

      const res = await pair(a, m, p);
      expect(res.linked).toBe(true);

      const manual = await tx(a, m);
      const plaid = await tx(a, p);
      expect(manual.status).toBe("active");
      expect(manual.match_status).toBe("linked");
      expect(manual.linked_group_id).toBe(res.linked_group_id);
      expect(manual.linked_plaid_transaction_id).toBe(p);
      expect(plaid.status).toBe("merged");
      expect(plaid.match_status).toBe("linked");
      expect(plaid.linked_group_id).toBe(res.linked_group_id);

      const links = await activeLinks(a);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        linked_group_id: res.linked_group_id,
        manual_transaction_id: m,
        plaid_transaction_record_id: p,
        status: "linked",
      });
    });
  });

  // ── 2. Candidate-insertion race ───────────────────────────────────────────
  describe("2. candidate-insertion race", () => {
    it("a second qualifying manual candidate committed mid-flight forces ambiguity, never a link", async () => {
      const m1 = await insertTx(a, { date: "2026-04-10", amount: 200 });
      const p = await insertTx(a, { date: "2026-04-11", amount: 200, source: "plaid" });

      // Test-only orchestration: connection B pre-acquires the SAME scope
      // advisory lock the production RPC takes first, which is a predictable
      // database lock boundary — no production object is modified.
      const key = await scopeLockKey(o, USER_A, ORG_A);
      await b.query("BEGIN");
      await b.query("SELECT pg_advisory_xact_lock($1::bigint)", [key]);

      const pidA = await backendPid(a);
      const linkAttempt = pair(a, m1, p); // blocks at the scope lock

      await waitUntilBlockedOnAdvisoryLock(o, pidA);

      // Commit a second qualifying manual candidate while A is parked.
      await insertTx(b, { date: "2026-04-10", amount: 200.5 });
      await b.query("COMMIT"); // releases the lock → A resumes and re-scans

      let result: Awaited<ReturnType<typeof pair>> | null = null;
      let serializationFailure = false;
      try {
        result = await linkAttempt;
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        // Acceptable: serialization failure followed by a safe retry.
        expect(["40001", "40P01"]).toContain(code);
        serializationFailure = true;
        result = await pair(a, m1, p);
      }

      expect(result!.linked).toBe(false);
      expect(["ambiguous_candidates", "race_conflict", "retry_required", "already_claimed", "race_lost"]).toContain(
        result!.reason,
      );

      // Unacceptable outcome check: neither candidate may be linked while both qualify.
      expect(await activeLinks(a)).toHaveLength(0);
      for (const id of [m1, p]) {
        const row = await tx(a, id);
        expect(row.match_status).not.toBe("linked");
        expect(row.linked_group_id).toBeNull();
        expect(row.status).toBe("active");
      }
      expect(typeof serializationFailure).toBe("boolean");
    }, 45_000);
  });

  // ── 3. Concurrent workers ─────────────────────────────────────────────────
  describe("3. concurrent workers on the same pair", () => {
    it("only one worker commits a link; no duplicate link or duplicate group", async () => {
      const m = await insertTx(a, { date: "2026-05-01", amount: 300 });
      const p = await insertTx(a, { date: "2026-05-02", amount: 299, source: "plaid" });

      const settled = await Promise.allSettled([pair(a, m, p), pair(b, m, p)]);
      const results = settled.map((s) => (s.status === "fulfilled" ? s.value : { linked: false, reason: "threw" }));
      expect(results.filter((r) => r.linked)).toHaveLength(1);
      for (const loser of results.filter((r) => !r.linked)) {
        // `wrong_sides` is the RPC's safe refusal once the winner has flipped the
        // canonical manual row to source_type='merged' — a pre-mutation bail, not a defect.
        expect(SAFE_REFUSALS).toContain(loser.reason);
      }

      const links = await activeLinks(o);
      expect(links).toHaveLength(1);
      const groups = new Set(links.map((l) => l.linked_group_id));
      expect(groups.size).toBe(1);

      // Final state internally consistent.
      const manual = await tx(o, m);
      const plaid = await tx(o, p);
      expect(manual.linked_group_id).toBe(links[0].linked_group_id);
      expect(plaid.linked_group_id).toBe(links[0].linked_group_id);
      expect(manual.status).toBe("active");
      expect(plaid.status).toBe("merged");
      const dupe = await o.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM (
           SELECT linked_group_id, manual_transaction_id, plaid_transaction_record_id
             FROM public.transaction_links WHERE status = 'linked'
            GROUP BY 1,2,3 HAVING count(*) > 1) x`,
      );
      expect(dupe.rows[0].n).toBe("0");
    }, 45_000);
  });

  // ── 4. Idempotency ────────────────────────────────────────────────────────
  describe("4. idempotency", () => {
    it("repeating the same match request changes nothing", async () => {
      const m = await insertTx(a, { date: "2026-06-01", amount: 75 });
      const p = await insertTx(a, { date: "2026-06-01", amount: 75, source: "plaid" });
      const first = await pair(a, m, p);
      expect(first.linked).toBe(true);

      const snapshot = async () => ({
        links: await activeLinks(o),
        all: (await o.query("SELECT * FROM public.transaction_links ORDER BY id")).rows,
        m: await tx(o, m),
        p: await tx(o, p),
      });
      const before = await snapshot();

      const second = await pair(a, m, p);
      const third = await pair(b, m, p);
      expect(second.linked).toBe(false);
      expect(third.linked).toBe(false);
      expect(SAFE_REFUSALS).toContain(second.reason);
      expect(SAFE_REFUSALS).toContain(third.reason);

      expect(await snapshot()).toEqual(before);
    });
  });

  // ── 5. Isolation ──────────────────────────────────────────────────────────
  describe("5. user and organization isolation", () => {
    it("cross-user and cross-organization candidates do not create ambiguity", async () => {
      const m = await insertTx(a, { date: "2026-07-10", amount: 500, user: USER_A, org: ORG_A });
      const p = await insertTx(a, { date: "2026-07-11", amount: 500, source: "plaid", user: USER_A, org: ORG_A });
      // Same date/amount, different user and different organization.
      await insertTx(a, { date: "2026-07-10", amount: 500, user: USER_B, org: ORG_B });
      await insertTx(a, { date: "2026-07-10", amount: 500, user: USER_A, org: ORG_B });

      const res = await pair(a, m, p);
      expect(res.linked).toBe(true);
      expect(await activeLinks(o)).toHaveLength(1);
    });

    it("cross-organization pairs are refused", async () => {
      const m = await insertTx(a, { date: "2026-07-10", amount: 500, org: ORG_A });
      const p = await insertTx(a, { date: "2026-07-10", amount: 500, source: "plaid", org: ORG_B });
      expect((await pair(a, m, p)).reason).toBe("organization_mismatch");
      expect(await activeLinks(o)).toHaveLength(0);
    });

    it("cross-user pairs are refused", async () => {
      const m = await insertTx(a, { date: "2026-07-10", amount: 500, user: USER_A, org: null });
      const p = await insertTx(a, { date: "2026-07-10", amount: 500, source: "plaid", user: USER_B, org: null });
      expect((await pair(a, m, p)).reason).toBe("user_mismatch");
      expect(await activeLinks(o)).toHaveLength(0);
    });

    it("rejects, before mutation, a direct RPC call carrying another user's transaction ids", async () => {
      const m = await insertTx(a, { date: "2026-08-10", amount: 900, user: USER_A, org: ORG_A });
      const p = await insertTx(a, { date: "2026-08-11", amount: 900, source: "plaid", user: USER_A, org: ORG_A });

      await expect(
        asServiceRoleForUser(b, USER_B, () => pair(b, m, p)),
      ).rejects.toMatchObject({ code: "42501" });

      expect(await activeLinks(o)).toHaveLength(0);
      expect((await tx(o, m)).match_status).not.toBe("linked");
      expect((await tx(o, p)).status).toBe("active");

      // The owner, under the same realistic claims shape, still succeeds.
      const owner = await asServiceRoleForUser(b, USER_A, () => pair(b, m, p));
      expect(owner.linked).toBe(true);
    });

    it("the RPC is not executable by anon or authenticated", async () => {
      for (const role of ["anon", "authenticated"]) {
        const res = await o.query<{ has: boolean }>(
          "SELECT has_function_privilege($1, 'public.auto_link_expense_pair(uuid,uuid,numeric)', 'EXECUTE') AS has",
          [role],
        );
        expect(res.rows[0].has).toBe(false);
      }
    });
  });

  // ── 6. Timezone boundaries ────────────────────────────────────────────────
  describe("6. timezone boundaries", () => {
    for (const zone of ["UTC", "America/Los_Angeles"]) {
      describe(zone, () => {
        beforeEach(async () => {
          await a.query(`SET TIME ZONE '${zone}'`);
        });

        it("exactly two calendar days apart qualifies", async () => {
          const m = await insertTx(a, { date: "2026-11-01", amount: 120 });
          const p = await insertTx(a, { date: "2026-11-03", amount: 120, source: "plaid" });
          expect((await pair(a, m, p)).linked).toBe(true);
        });

        it("three calendar days apart does not qualify", async () => {
          const m = await insertTx(a, { date: "2026-11-01", amount: 120 });
          const p = await insertTx(a, { date: "2026-11-04", amount: 120, source: "plaid" });
          expect((await pair(a, m, p)).reason).toBe("date_out_of_range");
          expect(await activeLinks(o)).toHaveLength(0);
        });

        it("date-only values do not shift across day/DST boundaries", async () => {
          // Nov 1 2026 is the US DST fall-back date.
          const rows = await a.query<{ d: string; back: string }>(
            `SELECT transaction_date::text AS d, (transaction_date + 2)::text AS back
               FROM public.transactions WHERE id = $1`,
            [await insertTx(a, { date: "2026-11-01", amount: 10 })],
          );
          expect(rows.rows[0].d).toBe("2026-11-01");
          expect(rows.rows[0].back).toBe("2026-11-03");
        });
      });
    }

    afterAll(async () => {
      await a.query("SET TIME ZONE 'UTC'");
    });
  });
});
