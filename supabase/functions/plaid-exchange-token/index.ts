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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
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

    // Save plaid_item
    const { data: itemRow, error: insertError } = await adminClient.from("plaid_items").insert({
      user_id: user.id,
      organization_id: orgId,
      access_token: exchangeData.access_token,
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
    if (accountsRes.ok && accountsData.accounts) {
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
      }));

      const { error: acctError } = await adminClient.from("plaid_accounts").insert(accountRows);
      if (acctError) console.error("Insert accounts error:", acctError);
    }

    return new Response(JSON.stringify({ success: true, item_id: exchangeData.item_id }), {
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
