// One-shot bootstrap: reads CRON_SECRET_VALUE_FOR_SCHEDULER from edge env and
// writes/refreshes the pg_cron job for planner-convert-daily with the secret
// embedded. Designed to be called once, then deleted.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Caller must know CRON_SECRET to invoke this bootstrap.
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided =
    req.headers.get("x-cron-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!cronSecret || provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const valueForScheduler = Deno.env.get("CRON_SECRET_VALUE_FOR_SCHEDULER");
  if (!valueForScheduler) {
    return new Response(JSON.stringify({ error: "Bootstrap secret missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (valueForScheduler !== cronSecret) {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET and CRON_SECRET_VALUE_FOR_SCHEDULER do not match" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const { error } = await admin.rpc("install_planner_cron_job", {
    _secret: valueForScheduler,
  });
  if (error) {
    console.error("install_planner_cron_job error", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
