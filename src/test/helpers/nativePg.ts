/**
 * TEST-ONLY native PostgreSQL harness for the expense auto-link suite.
 *
 * Unlike the PGlite fixture (`expenseAutoLinkDb.ts`), this harness talks to a
 * REAL PostgreSQL server over `pg` with INDEPENDENT connections, so true
 * multi-session concurrency (advisory locks, row locks, MVCC, serialization
 * failures) is exercised.
 *
 * The disposable database is provisioned by CI (`.github/workflows/native-pg-autolink.yml`,
 * PostgreSQL 18 service) or locally via `scripts/native-pg-test.sh`.
 * Set `TEST_DATABASE_URL` (or `NATIVE_PG_URL`); when neither is present the
 * suite skips instead of failing.
 *
 * No test-only object is ever added to a production migration: everything
 * test-specific lives in `src/test/sql/nativeBootstrap.sql` and in this file.
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";

export const NATIVE_PG_URL = process.env.TEST_DATABASE_URL || process.env.NATIVE_PG_URL || "";
export const hasNativePg = NATIVE_PG_URL.length > 0;

/** Real app migrations that define the auto-link database layer, in order. */
export const AUTO_LINK_MIGRATIONS = [
  "20260821041815_cfd60094-ebfb-4e91-b186-86827b8ba702.sql",
  "20260821041928_324c758f-7431-4a23-9d76-ac0e8ec3c176.sql",
  "20260821041950_e792c71b-d369-4d11-b198-b2f1626cb02a.sql",
  "20260821043642_950261a4-2d00-4e52-9811-3ba86a620121.sql",
  "20260821043700_743fd2b9-975a-4b1f-aee6-68be4b43eeeb.sql",
  "20260821045816_dd599615-5858-4ae9-9890-28834fc8a1e6.sql",
  "20260822171234_19db961c-0d75-4c46-bc30-48c0b46a2b2f.sql",
  "20260822171300_d89056be-3a2e-49ff-b969-687f2691c39b.sql",
];

const BOOTSTRAP = () => readFileSync(path.resolve("src/test/sql/nativeBootstrap.sql"), "utf8");
const migrationSql = (f: string) => readFileSync(path.resolve("supabase/migrations", f), "utf8");

export async function connect(): Promise<Client> {
  const c = new Client({ connectionString: NATIVE_PG_URL });
  await c.connect();
  return c;
}

/** Fresh schema + real migrations. Always tears the old schema down first. */
export async function provisionSchema(): Promise<void> {
  const c = await connect();
  try {
    await c.query("DROP SCHEMA IF EXISTS public CASCADE");
    await c.query("DROP SCHEMA IF EXISTS auth CASCADE");
    await c.query("CREATE SCHEMA public");
    await c.query("GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role");
    await c.query(BOOTSTRAP());
    for (const f of AUTO_LINK_MIGRATIONS) await c.query(migrationSql(f));
  } finally {
    await c.end();
  }
}

/** Remove all disposable rows between tests (schema/functions stay). */
export async function truncateAll(c: Client): Promise<void> {
  await c.query(
    "TRUNCATE public.transaction_links, public.transactions, public.organization_members, public.organizations CASCADE",
  );
}

export const USER_A = "11111111-1111-1111-1111-111111111111";
export const USER_B = "22222222-2222-2222-2222-222222222222";
export const ORG_A = "aaaaaaaa-0000-0000-0000-00000000000a";
export const ORG_B = "bbbbbbbb-0000-0000-0000-00000000000b";

export async function seedOrgs(c: Client): Promise<void> {
  await c.query(
    `INSERT INTO public.organizations (id, name, owner_user_id) VALUES ($1,'A',$3), ($2,'B',$4)
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B, USER_A, USER_B],
  );
  await c.query(
    `INSERT INTO public.organization_members (organization_id, user_id) VALUES ($1,$3), ($2,$4)
     ON CONFLICT DO NOTHING`,
    [ORG_A, ORG_B, USER_A, USER_B],
  );
}

export interface TxInput {
  id?: string;
  date: string;
  amount: number;
  source?: "manual" | "plaid";
  user?: string;
  org?: string | null;
}

export async function insertTx(c: Client, t: TxInput): Promise<string> {
  const res = await c.query<{ id: string }>(
    `INSERT INTO public.transactions
       (id, user_id, organization_id, transaction_date, amount, source_type, vendor)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, 'vendor')
     RETURNING id`,
    [t.id ?? null, t.user ?? USER_A, t.org === undefined ? ORG_A : t.org, t.date, t.amount, t.source ?? "manual"],
  );
  return res.rows[0].id;
}

export interface PairResult {
  linked: boolean;
  reason?: string;
  linked_group_id?: string;
}

export async function pair(c: Client, manual: string, plaid: string): Promise<PairResult> {
  const res = await c.query<{ r: PairResult }>("SELECT public.auto_link_expense_pair($1,$2,100) AS r", [manual, plaid]);
  return res.rows[0].r;
}

export async function tx(c: Client, id: string) {
  const res = await c.query(
    `SELECT id, status, match_status, linked_group_id, source_type, linked_plaid_transaction_id,
            linked_plaid_amount, linked_plaid_posted_date
       FROM public.transactions WHERE id = $1`,
    [id],
  );
  return res.rows[0];
}

export async function activeLinks(c: Client) {
  const res = await c.query(
    `SELECT id, linked_group_id, manual_transaction_id, plaid_transaction_record_id, status
       FROM public.transaction_links WHERE status = 'linked' ORDER BY id`,
  );
  return res.rows;
}

export async function backendPid(c: Client): Promise<number> {
  const res = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return res.rows[0].pid;
}

/**
 * Deterministic synchronization: wait until `pid` is genuinely BLOCKED on an
 * ungranted advisory lock in `pg_locks`. This observes real server lock state —
 * sleeps are only the polling interval, never the ordering mechanism.
 */
export async function waitUntilBlockedOnAdvisoryLock(observer: Client, pid: number, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await observer.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_locks
        WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`,
      [pid],
    );
    if (Number(res.rows[0].n) > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`pid ${pid} never blocked on an advisory lock`);
}

/** The scope lock key the production trigger/RPC use. Read-only mirror. */
export async function scopeLockKey(c: Client, user: string, org: string | null): Promise<string> {
  const res = await c.query<{ k: string }>(
    `SELECT hashtextextended('expense_autolink:' || $1::text || ':' || COALESCE($2::text,'-'), 0)::text AS k`,
    [user, org],
  );
  return res.rows[0].k;
}

/** Run a callback with a session acting as an authenticated user (JWT claims). */
export async function asAuthenticatedUser<T>(c: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await c.query("SET LOCAL ROLE authenticated");
    const out = await fn();
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/**
 * Run a callback as `service_role` (the only role granted EXECUTE on the RPC)
 * while carrying a specific user's JWT claims — the realistic edge-function
 * shape, so the SECURITY DEFINER ownership check is exercised.
 */
export async function asServiceRoleForUser<T>(c: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await c.query("SET LOCAL ROLE service_role");
    const out = await fn();
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

export async function serverVersion(c: Client): Promise<string> {
  const res = await c.query<{ v: string }>("SHOW server_version");
  return res.rows[0].v;
}
