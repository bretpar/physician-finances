// Plaid webhook receiver. Plaid calls this anonymously, so verify_jwt is false
// at the Supabase layer and we authenticate the request itself by verifying
// Plaid's `plaid-verification` JWT signature against Plaid's published JWK
// (and checking that the body hash matches the JWT's request_body_sha256
// claim and that the timestamp is recent). Only then do we touch the DB.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, plaid-verification",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5";

const PLAID_ENV = (Deno.env.get("PLAID_ENV") || "sandbox").toLowerCase();
const PLAID_BASE =
  PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : PLAID_ENV === "development"
    ? "https://development.plaid.com"
    : "https://sandbox.plaid.com";

// In-memory JWK cache (per isolate). Keyed by kid.
const jwkCache = new Map<string, { jwk: jose.JWK; fetchedAt: number }>();
const JWK_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function getPlaidJwk(kid: string): Promise<jose.JWK | null> {
  const cached = jwkCache.get(kid);
  if (cached && Date.now() - cached.fetchedAt < JWK_TTL_MS) return cached.jwk;

  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret =
    Deno.env.get("PLAID_SECRET") ||
    (PLAID_ENV === "sandbox" ? Deno.env.get("PLAID_SECRET_SANDBOX") : undefined);
  if (!clientId || !secret) {
    console.error("[plaid-webhook] missing Plaid credentials for JWK fetch");
    return null;
  }

  const res = await fetch(`${PLAID_BASE}/webhook_verification_key/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, key_id: kid }),
  });
  if (!res.ok) {
    console.error("[plaid-webhook] JWK fetch failed", res.status, await res.text());
    return null;
  }
  const json = await res.json();
  const jwk = json?.key as jose.JWK | undefined;
  if (!jwk || jwk.expired_at) return null;
  jwkCache.set(kid, { jwk, fetchedAt: Date.now() });
  return jwk;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPlaidSignature(
  jwt: string,
  rawBody: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let header: jose.ProtectedHeaderParameters;
  try {
    header = jose.decodeProtectedHeader(jwt);
  } catch {
    return { ok: false, reason: "malformed jwt" };
  }
  if (header.alg !== "ES256") return { ok: false, reason: `bad alg ${header.alg}` };
  const kid = header.kid;
  if (!kid) return { ok: false, reason: "missing kid" };

  const jwk = await getPlaidJwk(kid);
  if (!jwk) return { ok: false, reason: "unknown kid" };

  let payload: jose.JWTPayload & { request_body_sha256?: string };
  try {
    const key = await jose.importJWK(jwk, "ES256");
    const verified = await jose.jwtVerify(jwt, key, { algorithms: ["ES256"] });
    payload = verified.payload as typeof payload;
  } catch (e) {
    return { ok: false, reason: `signature invalid: ${(e as Error).message}` };
  }

  // Reject stale webhooks (>5 minutes old)
  const iat = Number(payload.iat || 0);
  if (!iat || Math.abs(Date.now() / 1000 - iat) > 5 * 60) {
    return { ok: false, reason: "stale jwt" };
  }

  const expectedHash = await sha256Hex(rawBody);
  if (payload.request_body_sha256 !== expectedHash) {
    return { ok: false, reason: "body hash mismatch" };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

  // Read raw body once — we need it both for hashing and for JSON parsing.
  const rawBody = await req.text();

  // Verify Plaid's signature before doing anything else.
  const sigHeader = req.headers.get("plaid-verification");
  if (!sigHeader) {
    console.warn("[plaid-webhook] missing plaid-verification header");
    return new Response(JSON.stringify({ error: "missing signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const verification = await verifyPlaidSignature(sigHeader, rawBody);
  if (!verification.ok) {
    console.warn("[plaid-webhook] signature verification failed:", verification.reason);
    return new Response(JSON.stringify({ error: "invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { /* no body */ }

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
