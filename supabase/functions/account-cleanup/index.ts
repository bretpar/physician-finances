// Account cleanup edge function. Supports two actions:
// - "erase":   wipes all app data for the calling user but keeps the auth account.
//              Resets tax_settings + onboarding flags so the user starts at onboarding again.
// - "delete":  performs an erase, then deletes the auth user (permanent).
//
// Both actions are scoped to the caller's user_id and are idempotent.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Tables that hold user-owned data. Order roughly: dependent rows first.
const USER_TABLES = [
  "transaction_attachments",
  "transaction_match_group_items",
  "transaction_match_groups",
  "transaction_match_ignores",
  "transaction_links",
  "planner_conversions",
  "income_entry_links",
  "income_entries",
  "income_forecasts",
  "income_pathway_history",
  "investment_income_entries",
  "stock_transactions",
  "projected_income_overrides",
  "projected_bonus_events",
  "projected_income_streams",
  "ytd_catchup_entries",
  "hsa_contributions",
  "retirement_contributions",
  "home_office_deductions",
  "mileage_entries",
  "tax_payments",
  "tax_savings",
  "transactions",
  "plaid_transactions",
  "plaid_deleted_tombstones",
  "plaid_accounts",
  "plaid_items",
  "companies",
];

async function deleteStorageForUser(admin: any, userId: string) {
  const bucket = "transaction-attachments";
  try {
    // List top-level prefixes inside the user folder, then recurse one level deep (transactionId folders).
    const { data: top, error } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    if (error || !top) return;
    const paths: string[] = [];
    for (const entry of top) {
      if (!entry?.name) continue;
      // entry is a folder (transactionId) — list inside
      const inner = await admin.storage.from(bucket).list(`${userId}/${entry.name}`, { limit: 1000 });
      if (inner.data) {
        for (const f of inner.data) {
          if (f?.name) paths.push(`${userId}/${entry.name}/${f.name}`);
        }
      } else if ((entry as any).id) {
        // It was a file at the top level
        paths.push(`${userId}/${entry.name}`);
      }
    }
    if (paths.length) await admin.storage.from(bucket).remove(paths);
  } catch (err) {
    console.warn("account-cleanup storage cleanup skipped", err);
  }
}

async function eraseUserData(admin: any, userId: string) {
  const errors: { table: string; error: string }[] = [];

  for (const table of USER_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      console.warn(`account-cleanup delete ${table} failed`, error);
      errors.push({ table, error: error.message || String(error) });
    }
  }

  await deleteStorageForUser(admin, userId);

  // Reset tax_settings: delete then re-insert fresh defaults so onboarding restarts.
  // Preserve organization_id so the user remains in their org.
  const { data: existing } = await admin
    .from("tax_settings")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  const orgId = existing?.organization_id ?? null;

  const { error: delTs } = await admin.from("tax_settings").delete().eq("user_id", userId);
  if (delTs) errors.push({ table: "tax_settings", error: delTs.message });

  const { error: insTs } = await admin.from("tax_settings").insert({
    user_id: userId,
    organization_id: orgId,
    onboarding_complete: false,
    onboarding_step: 1,
    onboarding_banner_dismissed: false,
    onboarding_first_name: "",
    ytd_catchup_choice: null,
  });
  if (insTs) errors.push({ table: "tax_settings(insert)", error: insTs.message });

  return errors;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(req, { error: "Server configuration error" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action !== "erase" && action !== "delete") {
      return jsonResponse(req, { error: "Invalid action" }, 400);
    }

    const errors = await eraseUserData(admin, userId);

    if (action === "delete") {
      const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
      if (authDelErr) {
        console.error("account-cleanup deleteUser failed", authDelErr);
        return jsonResponse(req, {
          ok: false,
          error: "Failed to delete auth user",
          detail: authDelErr.message,
          partial_errors: errors,
        }, 500);
      }
    }

    return jsonResponse(req, { ok: true, action, partial_errors: errors });
  } catch (error) {
    console.error("account-cleanup error", error);
    return jsonResponse(req, { error: "Internal error", detail: (error as Error).message }, 500);
  }
});
