// One-shot admin helper: re-installs the daily Plaid sync cron job using the
// CRON_SECRET edge-function env. Invoke this once after deploying schema
// changes that alter install_plaid_sync_cron_job.
//
// Auth: caller must present the same CRON_SECRET via the `x-cron-secret`
// header. No public exposure.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
import { createClient } from "npm:@supabase/supabase-js@2";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const provided = req.headers.get("x-cron-secret") || "";
  if (!provided || !timingSafeEqual(provided, cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await admin.rpc("install_plaid_sync_cron_job", { _secret: cronSecret });
  if (error) {
    console.error("install-plaid-cron rpc failed", error);
    return new Response(JSON.stringify({ error: "Failed to install cron job" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, schedule: "0 10 * * * UTC" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
