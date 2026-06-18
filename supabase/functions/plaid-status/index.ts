const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sandboxQa = (Deno.env.get("ENABLE_PLAID_SANDBOX_QA") || "").toLowerCase() === "true";
  const env = sandboxQa ? "sandbox" : (Deno.env.get("PLAID_ENV") || "sandbox");
  const hasSecret = env === "sandbox"
    ? Boolean(Deno.env.get("PLAID_SECRET_SANDBOX") || Deno.env.get("PLAID_SECRET"))
    : Boolean(Deno.env.get("PLAID_SECRET"));
  const configured = Boolean(Deno.env.get("PLAID_CLIENT_ID")) && hasSecret;

  return json({ plaid_env: env, sandbox_qa: sandboxQa, configured, is_production: env === "production" });
});
