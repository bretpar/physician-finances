// Plaid webhook receiver. Plaid calls this anonymously, so verify_jwt is false
// and we authenticate by looking up the item via the service role.
// On TRANSACTIONS / SYNC_UPDATES_AVAILABLE we trigger an incremental sync for
// just that item. On ITEM error / login-required webhooks we mark the item as
// needs_reauth so the UI can surface a reconnect prompt.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, plaid-verification",
};
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }

  const webhookType: string = String(body?.webhook_type || "").toUpperCase();
  const webhookCode: string = String(body?.webhook_code || "").toUpperCase();
  const plaidItemId: string | undefined = body?.item_id;

  console.log("[plaid-webhook] received", { webhookType, webhookCode, plaidItemId });

  if (!plaidItemId) {
    return new Response(JSON.stringify({ ok: true, ignored: "missing item_id" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Look up our internal plaid_items row by Plaid's item_id
  const { data: item, error: itemErr } = await admin
    .from("plaid_items")
    .select("id, user_id, status")
    .eq("item_id", plaidItemId)
    .maybeSingle();

  if (itemErr || !item) {
    console.error("[plaid-webhook] item not found", { plaidItemId, itemErr });
    // Always 200 to Plaid; don't make them retry forever for unknown items.
    return new Response(JSON.stringify({ ok: true, ignored: "unknown item" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Handle item-level errors -> mark needs_reauth
  if (webhookType === "ITEM") {
    if (
      webhookCode === "ERROR" ||
      webhookCode === "PENDING_EXPIRATION" ||
      webhookCode === "USER_PERMISSION_REVOKED" ||
      webhookCode === "LOGIN_REPAIRED" // re-mark active below for repaired
    ) {
      const status = webhookCode === "LOGIN_REPAIRED" ? "active" : "needs_reauth";
      const errMsg = body?.error?.error_message || body?.error?.error_code || webhookCode;
      await admin
        .from("plaid_items")
        .update({
          status,
          last_sync_error: status === "active" ? null : errMsg,
        })
        .eq("id", item.id);
      console.log("[plaid-webhook] item status updated", { id: item.id, status });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Handle transactions updates -> trigger incremental sync for this item
  if (
    webhookType === "TRANSACTIONS" &&
    (webhookCode === "SYNC_UPDATES_AVAILABLE" ||
      webhookCode === "INITIAL_UPDATE" ||
      webhookCode === "HISTORICAL_UPDATE" ||
      webhookCode === "DEFAULT_UPDATE" ||
      webhookCode === "TRANSACTIONS_REMOVED")
  ) {
    // Fire-and-forget invoke; Plaid expects a fast 200.
    const endpoint = `${SUPABASE_URL}/functions/v1/plaid-sync-transactions`;
    queueMicrotask(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": CRON_SECRET,
            "Authorization": `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({ user_id: item.user_id, item_id: item.id }),
        });
        console.log("[plaid-webhook] triggered sync", { item_id: item.id, status: res.status });
      } catch (e) {
        console.error("[plaid-webhook] sync invoke failed", { item_id: item.id, error: e });
      }
    });
    return new Response(JSON.stringify({ ok: true, triggered: "sync" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, ignored: `${webhookType}/${webhookCode}` }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
