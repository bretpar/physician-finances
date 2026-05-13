// Backend RLS test for plaid_items / plaid_items_safe.
//
// Asserts:
//   1. An authenticated user can SELECT their own rows from plaid_items_safe.
//   2. An authenticated user CANNOT see another user's rows in plaid_items_safe.
//   3. plaid_items_safe does not expose the access_token column.
//   4. An authenticated user CANNOT SELECT access_token from plaid_items
//      (RLS + revoked column / view-only access path).
//
// Run via: supabase--test_edge_functions  (Deno test runner, --allow-net --allow-env)
import { createClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  (Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "").split(",")[0] ||
  "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function makeUser(email: string, password: string) {
  const a = admin();
  // Best-effort cleanup of any prior test user with this email.
  const { data: list } = await a.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === email);
  if (existing) await a.auth.admin.deleteUser(existing.id);

  const { data, error } = await a.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return data.user;
}

async function signIn(email: string, password: string) {
  const c = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("signIn failed");
  return c;
}

async function ensureOrgAndPlaidItem(userId: string, institution: string) {
  const a = admin();
  // handle_new_user trigger should have created the org + profile already.
  const { data: prof } = await a
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  const orgId = prof?.organization_id ?? null;

  const { data: item, error } = await a
    .from("plaid_items")
    .insert({
      user_id: userId,
      organization_id: orgId,
      item_id: `test-item-${crypto.randomUUID()}`,
      access_token: "secret-access-token-should-never-leak",
      institution_id: "ins_test",
      institution_name: institution,
    })
    .select("id")
    .single();
  if (error) throw error;
  return item.id as string;
}

async function cleanup(userIds: string[]) {
  const a = admin();
  if (userIds.length) {
    await a.from("plaid_items").delete().in("user_id", userIds);
    for (const id of userIds) await a.auth.admin.deleteUser(id).catch(() => {});
  }
}

Deno.test("plaid_items_safe RLS: user isolation + access_token never exposed", async () => {
  const stamp = Date.now();
  const emailA = `rls-test-a-${stamp}@example.com`;
  const emailB = `rls-test-b-${stamp}@example.com`;
  const password = "TestPass123!xyz";

  const userA = await makeUser(emailA, password);
  const userB = await makeUser(emailB, password);

  try {
    const itemA = await ensureOrgAndPlaidItem(userA.id, "Bank A");
    const itemB = await ensureOrgAndPlaidItem(userB.id, "Bank B");

    const clientA = await signIn(emailA, password);

    // 1. User A reads own rows from plaid_items_safe.
    const { data: ownSafe, error: ownSafeErr } = await clientA
      .from("plaid_items_safe")
      .select("*");
    assertEquals(ownSafeErr, null, `own safe select error: ${ownSafeErr?.message}`);
    assert(ownSafe && ownSafe.length >= 1, "user A should see at least their own item");
    assert(
      ownSafe!.every((r: any) => r.id !== itemB),
      "user A must not see user B's item via plaid_items_safe",
    );
    assert(
      ownSafe!.some((r: any) => r.id === itemA),
      "user A should see their own item via plaid_items_safe",
    );

    // 2. plaid_items_safe must not expose access_token column.
    for (const row of ownSafe!) {
      assert(
        !("access_token" in row),
        "plaid_items_safe row must not include access_token",
      );
    }

    // 3. Explicitly attempting to select access_token via the view should fail or be empty.
    const { data: tokenAttempt, error: tokenAttemptErr } = await clientA
      .from("plaid_items_safe")
      .select("access_token");
    assert(
      tokenAttemptErr !== null ||
        (Array.isArray(tokenAttempt) &&
          tokenAttempt.every((r: any) => !("access_token" in r) || r.access_token == null)),
      "plaid_items_safe.access_token must not return a real token",
    );

    // 4. Direct query against plaid_items.access_token must not leak User B's token.
    const { data: directB } = await clientA
      .from("plaid_items")
      .select("id, access_token")
      .eq("id", itemB);
    assert(
      !directB || directB.length === 0,
      "user A must not be able to read user B's plaid_items row",
    );

    // 5. Even querying own plaid_items.access_token should never return the raw token
    //    to the client (column is either filtered by RLS or returns the **vault** sentinel
    //    after the vault patch). We only enforce that the raw secret is never exposed.
    const { data: directOwn } = await clientA
      .from("plaid_items")
      .select("id, access_token")
      .eq("id", itemA);
    if (directOwn && directOwn.length) {
      for (const r of directOwn as any[]) {
        assert(
          r.access_token !== "secret-access-token-should-never-leak",
          "raw access_token must never be readable by the authenticated client",
        );
      }
    }
  } finally {
    await cleanup([userA.id, userB.id]);
  }
});
