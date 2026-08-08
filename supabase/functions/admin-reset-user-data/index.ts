// Developer-only QA data reset.
//
// Deletes a target user's user-created financial/test data and re-provisions
// their tax_settings row with the same defaults a brand-new account receives.
// This is deliberately SEPARATE from account deletion: the auth user, email,
// password, profile, organization membership and user_roles rows are never
// touched, so the account keeps its identity, role and admin access.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const DEVELOPER_ROLES = ["developer", "super_admin", "admin"];

/**
 * User-created financial/test data, dependent rows first. Identity/access
 * tables (auth.users, profiles, user_roles, organizations,
 * organization_members) are intentionally EXCLUDED.
 */
export const QA_RESET_TABLES = [
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
  "student_loans",
  "companies",
] as const;

/** Tables/records the reset must never modify. Reported back for auditability. */
export const QA_PRESERVED = [
  "auth.users",
  "profiles",
  "user_roles",
  "organizations",
  "organization_members",
] as const;

const inFlight = new Set<string>();

async function deleteStorageForUser(admin: any, userId: string) {
  const bucket = "transaction-attachments";
  try {
    const { data: top } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    const paths: string[] = [];
    for (const entry of top || []) {
      if (!entry?.name) continue;
      const inner = await admin.storage.from(bucket).list(`${userId}/${entry.name}`, { limit: 1000 });
      if (inner.data?.length) {
        for (const f of inner.data) if (f?.name) paths.push(`${userId}/${entry.name}/${f.name}`);
      } else {
        paths.push(`${userId}/${entry.name}`);
      }
    }
    if (paths.length) await admin.storage.from(bucket).remove(paths);
    return paths.length;
  } catch (err) {
    console.warn("admin-reset-user-data: storage cleanup skipped", err);
    return 0;
  }
}

export async function resetUserData(admin: any, userId: string) {
  const deletedByTable: Record<string, number> = {};
  const failedTables: Array<{ table: string; error: string }> = [];

  for (const table of QA_RESET_TABLES) {
    const { data, error } = await admin.from(table).delete().eq("user_id", userId).select("id");
    if (error) {
      console.warn(`admin-reset-user-data: ${table} delete failed`, error);
      failedTables.push({ table, error: error.message || String(error) });
      continue;
    }
    deletedByTable[table] = (data || []).length;
  }

  const attachmentsRemoved = await deleteStorageForUser(admin, userId);

  // Settings: re-provision with the exact defaults a new signup receives
  // (handle_new_user inserts user_id + organization_id only). This also
  // resets onboarding state, since onboarding lives on tax_settings.
  let settingsReset = false;
  let onboardingReset = false;
  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  const { error: settingsDelErr } = await admin.from("tax_settings").delete().eq("user_id", userId);
  if (settingsDelErr) {
    failedTables.push({ table: "tax_settings", error: settingsDelErr.message });
  } else {
    const { error: settingsInsErr } = await admin
      .from("tax_settings")
      .insert({ user_id: userId, organization_id: profile?.organization_id ?? null });
    if (settingsInsErr) {
      failedTables.push({ table: "tax_settings", error: settingsInsErr.message });
    } else {
      settingsReset = true;
      onboardingReset = true;
    }
  }

  return {
    deleted_by_table: deletedByTable,
    total_rows_deleted: Object.values(deletedByTable).reduce((s, n) => s + n, 0),
    attachments_removed: attachmentsRemoved,
    settings_reset: settingsReset,
    onboarding_reset: onboardingReset,
    failed_tables: failedTables,
    preserved: QA_PRESERVED,
  };
}

export async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(req, { error: "Server configuration error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse(req, { error: "Unauthorized" }, 401);
  const token = authHeader.replace(/^Bearer\s+/i, "");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return jsonResponse(req, { error: "Unauthorized" }, 401);
  const callerId = userData.user.id;

  // Independent server-side developer verification — never trust the client.
  const { data: callerRoles, error: roleErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId);
  if (roleErr) return jsonResponse(req, { error: "Could not verify permissions" }, 500);
  const isDeveloper = (callerRoles || []).some((r: { role: string }) => DEVELOPER_ROLES.includes(r.role));
  if (!isDeveloper) return jsonResponse(req, { error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(userId)) return jsonResponse(req, { error: "user_id must be a valid UUID" }, 400);
  if (body?.confirm !== "RESET") {
    return jsonResponse(req, { error: 'confirm must be "RESET"' }, 400);
  }

  const { data: target, error: targetErr } = await admin.auth.admin.getUserById(userId);
  if (targetErr || !target?.user) return jsonResponse(req, { error: "User not found" }, 404);

  if (inFlight.has(userId)) {
    return jsonResponse(req, { error: "A reset for this account is already in progress." }, 409);
  }
  inFlight.add(userId);
  try {
    const result = await resetUserData(admin, userId);

    // The auth account and role must still exist afterwards.
    const { data: after } = await admin.auth.admin.getUserById(userId);
    const { data: rolesAfter } = await admin.from("user_roles").select("role").eq("user_id", userId);

    return jsonResponse(req, {
      ok: result.failed_tables.length === 0,
      user_id: userId,
      email: target.user.email ?? null,
      auth_account_preserved: !!after?.user,
      roles_preserved: (rolesAfter || []).map((r: { role: string }) => r.role),
      ...result,
    });
  } catch (err) {
    console.error("admin-reset-user-data failed", err);
    return jsonResponse(req, { error: err instanceof Error ? err.message : String(err) }, 500);
  } finally {
    inFlight.delete(userId);
  }
}

Deno.serve(handler);
