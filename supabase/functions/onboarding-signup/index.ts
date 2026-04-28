import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { email } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return jsonResponse({ error: "Enter a valid email address." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Auth configuration is missing.");

    const admin = createClient(supabaseUrl, serviceRoleKey);
    let page = 1;
    const perPage = 1000;

    while (page <= 20) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const users = data?.users || [];
      if (users.some((user) => user.email?.toLowerCase() === normalizedEmail)) {
        return jsonResponse({ exists: true });
      }
      if (users.length < perPage) break;
      page += 1;
    }

    return jsonResponse({ exists: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check this email.";
    return jsonResponse({ error: message }, 400);
  }
});
