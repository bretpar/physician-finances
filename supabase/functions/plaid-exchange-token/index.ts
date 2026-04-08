import { corsHeaders } from "@supabase/supabase-js/cors";
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
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
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
    const { public_token, institution_name } = body;

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

    // Store using service role to bypass RLS for access_token storage
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: insertError } = await adminClient.from("plaid_items").insert({
      user_id: user.id,
      access_token: exchangeData.access_token,
      item_id: exchangeData.item_id,
      institution_name: institution_name || "Unknown Bank",
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to save connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
