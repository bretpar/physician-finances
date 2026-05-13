const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET = Deno.env.get("PLAID_SECRET");

    const missing: string[] = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!PLAID_CLIENT_ID) missing.push("PLAID_CLIENT_ID");
    if (!PLAID_SECRET) missing.push("PLAID_SECRET");
    if (missing.length > 0) {
      console.error("plaid-exchange-token missing env vars:", missing);
      return new Response(JSON.stringify({ error: `Server misconfigured: missing ${missing.join(", ")}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { public_token, institution_name, institution_id } = body;

    if (!public_token || typeof public_token !== "string") {
      return new Response(JSON.stringify({ error: "public_token is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
    const PLAID_ENV = Deno.env.get("PLAID_ENV") || "sandbox";

    const plaidHost = PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : PLAID_ENV === "development"
        ? "https://development.plaid.com"
        : "https://sandbox.plaid.com";

    // Exchange public token
    const exchangeRes = await fetch(`${plaidHost}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        public_token,
      }),
    });

    const exchangeData = await exchangeRes.json();
    if (!exchangeRes.ok) {
      console.error("Plaid exchange error:", exchangeData);
      return new Response(JSON.stringify({ error: exchangeData.error_message || "Exchange failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user's org_id
    const { data: orgMember } = await adminClient
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    const orgId = orgMember?.organization_id;

    // Save plaid_item with placeholder token (will be moved to vault)
    const { data: itemRow, error: insertError } = await adminClient.from("plaid_items").insert({
      user_id: user.id,
      organization_id: orgId,
      access_token: "**pending_vault**",
      item_id: exchangeData.item_id,
      institution_name: institution_name || "Unknown Bank",
      institution_id: institution_id || "",
      status: "active",
    }).select("id").single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to save connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store the access token securely in Vault
    const { error: vaultError } = await adminClient.rpc("store_plaid_token_in_vault", {
      _item_id: itemRow.id,
      _token: exchangeData.access_token,
    });
    if (vaultError) {
      console.error("Vault store error:", vaultError);
      // Roll back the placeholder row so we never leave a token unstored.
      await adminClient.from("plaid_items").delete().eq("id", itemRow.id);
      return new Response(JSON.stringify({ error: "Failed to securely store bank connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch accounts from Plaid
    const accountsRes = await fetch(`${plaidHost}/accounts/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: exchangeData.access_token,
      }),
    });

    const accountsData = await accountsRes.json();
    let returnedAccounts: any[] = [];

    if (accountsRes.ok && accountsData.accounts) {
      // Insert all accounts with sync_enabled = false initially (user will review)
      const accountRows = accountsData.accounts.map((acct: any) => ({
        user_id: user.id,
        organization_id: orgId,
        plaid_item_id: itemRow.id,
        plaid_account_id: acct.account_id,
        account_name: acct.name || acct.official_name || "",
        account_mask: acct.mask || null,
        account_type: acct.type || "",
        account_subtype: acct.subtype || null,
        current_balance: acct.balances?.current ?? null,
        available_balance: acct.balances?.available ?? null,
        is_active: true,
        sync_enabled: false, // User must review and enable
      }));

      const { error: acctError } = await adminClient.from("plaid_accounts").insert(accountRows);
      if (acctError) console.error("Insert accounts error:", acctError);

      returnedAccounts = accountRows.map((r: any) => ({
        plaid_account_id: r.plaid_account_id,
        account_name: r.account_name,
        account_mask: r.account_mask,
        account_type: r.account_type,
        account_subtype: r.account_subtype,
      }));
    }

    return new Response(JSON.stringify({
      success: true,
      item_id: exchangeData.item_id,
      item_db_id: itemRow.id,
      institution_name: institution_name || "Unknown Bank",
      accounts: returnedAccounts,
      needs_review: true,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
