// Plaid webhook receiver. Plaid calls this anonymously, so verify_jwt is false
// and we authenticate by verifying the `plaid-verification` JWT against Plaid's
// JWK endpoint, then by looking up the item via the service role.
// On TRANSACTIONS / SYNC_UPDATES_AVAILABLE we trigger an incremental sync for
// just that item. On ITEM error / login-required webhooks we mark the item as
// needs_reauth so the UI can surface a reconnect prompt.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, plaid-verification",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import { importJWK, jwtVerify, decodeProtectedHeader, type JWK } from "npm:jose@5";

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
const SANDBOX_QA = (Deno.env.get("ENABLE_PLAID_SANDBOX_QA") || "").toLowerCase() === "true";
const PLAID_ENV_RESOLVED = SANDBOX_QA ? "sandbox" : (Deno.env.get("PLAID_ENV") || "sandbox");
const PLAID_SECRET = PLAID_ENV_RESOLVED === "sandbox"
  ? (Deno.env.get("PLAID_SECRET_SANDBOX") || Deno.env.get("PLAID_SECRET"))
  : Deno.env.get("PLAID_SECRET");
const PLAID_HOST = PLAID_ENV_RESOLVED === "production"
  ? "https://production.plaid.com"
  : PLAID_ENV_RESOLVED === "development"
    ? "https://development.plaid.com"
    : "https://sandbox.plaid.com";

const jwkCache = new Map<string, JWK>();

async function fetchJwk(kid: string): Promise<JWK | null> {
  const cached = jwkCache.get(kid);
  if (cached) return cached;
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) return null;
  try {
    const res = await fetch(`${PLAID_HOST}/webhook_verification_key/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, key_id: kid }),
    });
    if (!res.ok) {
      console.error("[plaid-webhook] jwk fetch failed", { kid, status: res.status });
      return null;
    }
    const data = await res.json();
    const jwk: JWK | undefined = data?.key;
    if (!jwk) return null;
    jwkCache.set(kid, jwk);
    return jwk;
  } catch (e) {
    console.error("[plaid-webhook] jwk fetch exception", e);
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPlaidJwt(token: string, rawBody: string): Promise<boolean> {
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "ES256" || !header.kid) return false;
    const jwk = await fetchJwk(header.kid);
    if (!jwk) return false;
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(token, key, { algorithms: ["ES256"] });
    // Reject tokens older than 5 minutes
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    if (Math.abs(Date.now() / 1000 - iat) > 5 * 60) return false;
    const expectedHash = await sha256Hex(rawBody);
    return payload.request_body_sha256 === expectedHash;
  } catch (e) {
    console.error("[plaid-webhook] jwt verify failed", e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

  const rawBody = await req.text();

  // Verify Plaid's request signature. In sandbox without PLAID_CLIENT_ID we
  // log and skip to avoid breaking local development, but production always
  // enforces.
  const verificationToken = req.headers.get("plaid-verification") || "";
  if (verificationToken) {
    const ok = await verifyPlaidJwt(verificationToken, rawBody);
    if (!ok) {
      console.warn("[plaid-webhook] rejected unverified webhook");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else if (PLAID_ENV_RESOLVED === "production") {
    console.warn("[plaid-webhook] missing plaid-verification header in production");
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = JSON.parse(rawBody); } catch { /* no body */ }

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
      webhookCode === "LOGIN_REPAIRED"
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

  if (
    webhookType === "TRANSACTIONS" &&
    (webhookCode === "SYNC_UPDATES_AVAILABLE" ||
      webhookCode === "INITIAL_UPDATE" ||
      webhookCode === "HISTORICAL_UPDATE" ||
      webhookCode === "DEFAULT_UPDATE" ||
      webhookCode === "TRANSACTIONS_REMOVED")
  ) {
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
