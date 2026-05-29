// Account cleanup edge function.
// Permanently deletes all user-owned data and the auth account itself.
// Scoped strictly to the authenticated caller's user_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Tables that hold user-owned financial/app data. Order roughly: dependent
// rows first so deletes are deterministic if foreign keys are added later.
export const USER_SCOPED_FINANCIAL_TABLES = [
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
  "tax_settings",
] as const;

async function deleteStorageForUser(admin: any, userId: string) {
  const bucket = "transaction-attachments";
  try {
    const { data: top, error } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    if (error || !top) return;
    const paths: string[] = [];
    for (const entry of top) {
      if (!entry?.name) continue;
      const inner = await admin.storage.from(bucket).list(`${userId}/${entry.name}`, { limit: 1000 });
      if (inner.data) {
        for (const f of inner.data) {
          if (f?.name) paths.push(`${userId}/${entry.name}/${f.name}`);
        }
      } else if ((entry as any).id) {
        paths.push(`${userId}/${entry.name}`);
      }
    }
    if (paths.length) await admin.storage.from(bucket).remove(paths);
  } catch (err) {
    console.warn("account-cleanup storage cleanup skipped", err);
  }
}

export async function deleteUserData(admin: any, userId: string) {
  const errors: { table: string; error: string }[] = [];

  for (const table of USER_SCOPED_FINANCIAL_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      console.warn(`account-cleanup delete ${table} failed`, error);
      errors.push({ table, error: error.message || String(error) });
    }
  }

  await deleteStorageForUser(admin, userId);

  // Profile row will cascade with the auth user; delete proactively to keep
  // org membership tidy if any FK is missing.
  const { error: orgMemErr } = await admin
    .from("organization_members")
    .delete()
    .eq("user_id", userId);
  if (orgMemErr) errors.push({ table: "organization_members", error: orgMemErr.message });

  const { error: profErr } = await admin
    .from("profiles")
    .delete()
    .eq("user_id", userId);
  if (profErr) errors.push({ table: "profiles", error: profErr.message });

  if (errors.length > 0) {
    throw new Error(
      `Account delete did not fully complete. Failed tables: ${errors.map((e) => e.table).join(", ")}`,
    );
  }

  return errors;
}

export async function handler(req: Request) {
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
    if (action !== "delete") {
      return jsonResponse(req, { error: "Invalid action" }, 400);
    }

    try {
      await deleteUserData(admin, userId);
    } catch (deleteError) {
      console.error("account-cleanup data delete failed", deleteError);
      return jsonResponse(req, {
        ok: false,
        error: "Failed to delete account data",
        detail: (deleteError as Error).message,
      }, 500);
    }

    const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
    if (authDelErr) {
      console.error("account-cleanup deleteUser failed", authDelErr);
      return jsonResponse(req, {
        ok: false,
        error: "Failed to delete auth user",
        detail: authDelErr.message,
      }, 500);
    }

    return jsonResponse(req, { ok: true, action: "delete" });
  } catch (error) {
    console.error("account-cleanup error", error);
    return jsonResponse(req, { error: "Internal error", detail: (error as Error).message }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handler);
}
