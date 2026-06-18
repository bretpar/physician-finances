const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "unauthorized", message: "Not authenticated" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "unauthorized", message: "Invalid or expired session" }, 401);
    }

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const SANDBOX_QA = (Deno.env.get("ENABLE_PLAID_SANDBOX_QA") || "").toLowerCase() === "true";
    // QA flag forces sandbox regardless of PLAID_ENV, preventing accidental real-bank Link.
    const PLAID_ENV = SANDBOX_QA ? "sandbox" : (Deno.env.get("PLAID_ENV") || "sandbox");
    const PLAID_SECRET =
      PLAID_ENV === "sandbox"
        ? (Deno.env.get("PLAID_SECRET_SANDBOX") || Deno.env.get("PLAID_SECRET"))
        : Deno.env.get("PLAID_SECRET");

    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      console.error("Plaid not configured: missing PLAID_CLIENT_ID or PLAID_SECRET");
      const msg = SANDBOX_QA && PLAID_ENV === "sandbox" && !PLAID_SECRET
        ? "Plaid Sandbox is not configured. Set PLAID_SECRET_SANDBOX before running QA. Real-bank Link is blocked while ENABLE_PLAID_SANDBOX_QA=true."
        : "Bank connection is not configured yet. Please contact support.";
      return json({ error: "plaid_not_configured", message: msg }, 503);
    }

    const plaidHost =
      PLAID_ENV === "production"
        ? "https://production.plaid.com"
        : PLAID_ENV === "development"
          ? "https://development.plaid.com"
          : "https://sandbox.plaid.com";

    const response = await fetch(`${plaidHost}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        user: { client_user_id: user.id },
        client_name: "Physician Finance",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
        transactions: { days_requested: 730 },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Plaid link/token/create error:", {
        status: response.status,
        error_code: data?.error_code,
        error_type: data?.error_type,
        error_message: data?.error_message,
        request_id: data?.request_id,
      });
      return json(
        {
          error: "plaid_error",
          message: "Unable to start bank connection. Please try again.",
          plaid_error_code: data?.error_code ?? null,
        },
        502,
      );
    }

    return json({ link_token: data.link_token, plaid_env: PLAID_ENV, sandbox_qa: SANDBOX_QA });
  } catch (err) {
    console.error("plaid-create-link-token unexpected error:", err);
    return json(
      { error: "internal_error", message: "Unable to start bank connection. Please try again." },
      500,
    );
  }
});
