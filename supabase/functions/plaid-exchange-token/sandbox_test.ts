// End-to-end Plaid sandbox test.
//
// Uses PLAID_SECRET_SANDBOX (separate from production PLAID_SECRET) so this test
// never touches real user connections. Production code paths continue to use
// PLAID_SECRET + PLAID_ENV unchanged.
//
// Flow:
//   1. Create a sandbox public_token via Plaid /sandbox/public_token/create
//   2. Exchange it via /item/public_token/exchange (sandbox)
//   3. Insert a plaid_items row + store the token via store_plaid_token_in_vault()
//   4. Assert vault_secret_id is populated, access_token is masked,
//      and get_plaid_access_token() returns the real token to service role.
//   5. Cleanup.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET_SANDBOX = Deno.env.get("PLAID_SECRET_SANDBOX") ?? "";

const PLAID_SANDBOX_BASE = "https://sandbox.plaid.com";

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function plaid(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_SANDBOX_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET_SANDBOX,
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Plaid ${path} failed: ${JSON.stringify(json)}`);
  return json;
}

Deno.test({
  name: "Plaid sandbox: full token exchange + vault storage round-trip",
  ignore: !PLAID_SECRET_SANDBOX,
  fn: async () => {
    // 1. Create a real sandbox public token.
    const pub = await plaid("/sandbox/public_token/create", {
      institution_id: "ins_109508", // First Platypus Bank (sandbox)
      initial_products: ["transactions"],
    });
    const publicToken: string = pub.public_token;

    // 2. Exchange for an access_token in sandbox.
    const ex = await plaid("/item/public_token/exchange", {
      public_token: publicToken,
    });
    const accessToken: string = ex.access_token;
    const itemId: string = ex.item_id;
    assert(accessToken.startsWith("access-sandbox-"), "expected sandbox access token");

    // 3. Persist via the same path the production edge function uses.
    const a = admin();
    const { data: anyUser } = await a.auth.admin.listUsers();
    const owner = anyUser.users[0];
    assert(owner, "need at least one user in the project to attach the test item to");

    const { data: prof } = await a
      .from("profiles")
      .select("organization_id")
      .eq("user_id", owner.id)
      .maybeSingle();

    const { data: item, error: insertErr } = await a
      .from("plaid_items")
      .insert({
        user_id: owner.id,
        organization_id: prof?.organization_id ?? null,
        item_id: itemId,
        access_token: accessToken, // will be replaced by **vault** sentinel
        institution_id: "ins_109508",
        institution_name: "Sandbox Bank (test)",
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    try {
      const { error: vaultErr } = await a.rpc("store_plaid_token_in_vault", {
        _item_id: item.id,
        _token: accessToken,
      });
      if (vaultErr) throw vaultErr;

      // 4. Verify masked column + vault_secret_id populated.
      const { data: row } = await a
        .from("plaid_items")
        .select("access_token, vault_secret_id")
        .eq("id", item.id)
        .single();
      assertEquals(row?.access_token, "**vault**");
      assert(row?.vault_secret_id, "vault_secret_id should be populated");

      // 5. Service role can decrypt.
      const { data: decrypted, error: decErr } = await a.rpc("get_plaid_access_token", {
        _item_id: item.id,
      });
      if (decErr) throw decErr;
      assertEquals(decrypted, accessToken);
    } finally {
      // Cleanup DB row + invalidate Plaid item.
      await a.from("plaid_items").delete().eq("id", item.id);
      await plaid("/item/remove", { access_token: accessToken }).catch(() => {});
    }
  },
});
