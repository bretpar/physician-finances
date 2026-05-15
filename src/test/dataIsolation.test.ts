/**
 * Cross-user data isolation tests.
 *
 * These tests run against the real Lovable Cloud backend and confirm that:
 *   1. Two distinct test users get distinct organizations.
 *   2. Each user can only SELECT their own rows across every user-owned table.
 *   3. Cross-user UPDATE / DELETE attempts are silently blocked by RLS.
 *
 * They are gated behind RUN_DATA_ISOLATION=1 because they require live
 * network access. Default `vitest run` skips them.
 *
 * To run locally:
 *   RUN_DATA_ISOLATION=1 bunx vitest run src/test/dataIsolation.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = process.env.RUN_DATA_ISOLATION === "1";
const URL = process.env.VITE_SUPABASE_URL ?? "";
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

const TABLES = [
  "companies", "income_entries", "transactions", "projected_income_streams",
  "projected_bonus_events", "projected_income_overrides", "planner_conversions",
  "tax_settings", "investment_income_entries", "stock_transactions",
  "tax_payments", "tax_savings", "mileage_entries",
] as const;

// Pre-seeded personas from supabase/functions/test-seed-users.
const USER_A = { email: "test-w2-1099@paycheckmd.test", password: "TestSeed!2026" };
const USER_B = { email: "test-1099@paycheckmd.test",     password: "TestSeed!2026" };

async function clientFor(email: string, password: string): Promise<{ client: SupabaseClient; userId: string; orgId: string }> {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`Sign-in failed for ${email}: ${error?.message}`);
  const userId = data.user.id;
  const { data: m } = await client.from("organization_members").select("organization_id").eq("user_id", userId).single();
  return { client, userId, orgId: (m as any).organization_id };
}

describe.runIf(RUN && URL && ANON)("multi-user data isolation", () => {
  let A: Awaited<ReturnType<typeof clientFor>>;
  let B: Awaited<ReturnType<typeof clientFor>>;

  beforeAll(async () => {
    A = await clientFor(USER_A.email, USER_A.password);
    B = await clientFor(USER_B.email, USER_B.password);
  }, 30_000);

  it("each user has a distinct organization", () => {
    expect(A.orgId).toBeTruthy();
    expect(B.orgId).toBeTruthy();
    expect(A.orgId).not.toBe(B.orgId);
    expect(A.userId).not.toBe(B.userId);
  });

  it("user A cannot see any row owned by user B (and vice versa)", async () => {
    for (const table of TABLES) {
      // From A's session, look for any row whose user_id is B.
      const { data: leakAB } = await A.client.from(table).select("id").eq("user_id", B.userId).limit(5);
      expect(leakAB ?? [], `A leaked B rows from ${table}`).toHaveLength(0);

      // From B's session, look for any row whose user_id is A.
      const { data: leakBA } = await B.client.from(table).select("id").eq("user_id", A.userId).limit(5);
      expect(leakBA ?? [], `B leaked A rows from ${table}`).toHaveLength(0);

      // From A's session, look for any row in B's organization.
      const { data: orgLeakAB } = await A.client.from(table).select("id").eq("organization_id", B.orgId).limit(5);
      expect(orgLeakAB ?? [], `A leaked B org rows from ${table}`).toHaveLength(0);
    }
  }, 60_000);

  it("user A cannot mutate user B's rows", async () => {
    // Ensure B has at least one row to attack.
    const { data: bCompany } = await B.client.from("companies").insert({
      user_id: B.userId, organization_id: B.orgId, name: "B-isolation-target",
    }).select("id").single();
    expect(bCompany?.id).toBeTruthy();

    // A tries to UPDATE it — RLS makes this affect 0 rows.
    const { data: upd } = await A.client.from("companies").update({ name: "HACKED" }).eq("id", bCompany!.id).select("id");
    expect(upd ?? []).toHaveLength(0);

    // A tries to DELETE it — also 0 rows.
    const { data: del } = await A.client.from("companies").delete().eq("id", bCompany!.id).select("id");
    expect(del ?? []).toHaveLength(0);

    // Confirm B's row is still intact and unchanged.
    const { data: still } = await B.client.from("companies").select("name").eq("id", bCompany!.id).single();
    expect((still as any)?.name).toBe("B-isolation-target");

    // Cleanup.
    await B.client.from("companies").delete().eq("id", bCompany!.id);
  }, 30_000);

  it("user A cannot insert a row pretending to be user B", async () => {
    const { error } = await A.client.from("companies").insert({
      user_id: B.userId, organization_id: B.orgId, name: "spoof",
    });
    // Either RLS rejects (with_check) or the enforce_user_id_matches_auth trigger does.
    expect(error).toBeTruthy();
  });
});

describe.skipIf(RUN && URL && ANON)("data isolation suite skipped (set RUN_DATA_ISOLATION=1 to enable)", () => {
  it("placeholder", () => { expect(true).toBe(true); });
});
