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

  // This bootstrap reads its own copy of the value from edge env.
  // Authentication: the caller must be the signed-in app user with a valid JWT.
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
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
