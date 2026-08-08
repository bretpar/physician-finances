// Developer-only bulk account deletion.
// Verifies the caller is a developer server-side, refuses to delete the caller
// or the last remaining developer, then removes user-owned rows followed by the
// auth user itself.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const MAX_BATCH = 50;

// User-owned tables keyed by user_id. Mirrors account-cleanup's list so a
// developer-initiated delete leaves the same (empty) footprint as a
// self-service delete.
const USER_SCOPED_TABLES = [
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
  "student_loans",
  "tax_settings",
  "user_roles",
  "organization_members",
  "profiles",
] as const;

const DEVELOPER_ROLES = ["developer", "super_admin", "admin"];

// In-flight guard so a double-clicked request cannot delete twice.
const inFlight = new Set<string>();

async function deleteUserOwnedData(admin: any, userId: string) {
  const orphaned: string[] = [];

  const { data: orgRows } = await admin
    .from("organizations")
    .select("id")
    .eq("owner_user_id", userId);
  const ownedOrgIds = ((orgRows || []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);

  for (const table of USER_SCOPED_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      console.warn(`admin-delete-users: ${table} delete failed`, error);
      orphaned.push(table);
    }
  }

  try {
    const bucket = "transaction-attachments";
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
  } catch (err) {
    console.warn("admin-delete-users: storage cleanup skipped", err);
  }

  if (ownedOrgIds.length) {
    const { error } = await admin.from("organizations").delete().in("id", ownedOrgIds);
    if (error) orphaned.push("organizations");
  }

  return orphaned;
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

  // Independent server-side developer verification (never trust the client).
  const { data: callerRoles, error: roleErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId);
  if (roleErr) return jsonResponse(req, { error: "Could not verify permissions" }, 500);
  const isDeveloper = (callerRoles || []).some((r: { role: string }) => DEVELOPER_ROLES.includes(r.role));
  if (!isDeveloper) return jsonResponse(req, { error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const requested: unknown = body?.user_ids;
  if (!Array.isArray(requested) || requested.length === 0) {
    return jsonResponse(req, { error: "user_ids must be a non-empty array" }, 400);
  }
  if (requested.length > MAX_BATCH) {
    return jsonResponse(req, { error: `Cannot delete more than ${MAX_BATCH} accounts at once` }, 400);
  }
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = Array.from(new Set(requested.map(String)));
  if (ids.some((id) => !uuidRe.test(id))) {
    return jsonResponse(req, { error: "user_ids must be valid UUIDs" }, 400);
  }

  const { data: devRows, error: devErr } = await admin
    .from("user_roles")
    .select("user_id, role")
    .in("role", DEVELOPER_ROLES);
  if (devErr) return jsonResponse(req, { error: "Could not verify permissions" }, 500);
  const developerIds = new Set((devRows || []).map((r: { user_id: string }) => r.user_id));

  const skipped: Array<{ user_id: string; reason: string }> = [];
  const targets: string[] = [];
  for (const id of ids) {
    if (id === callerId) {
      skipped.push({ user_id: id, reason: "You cannot delete the account you are signed in with." });
      continue;
    }
    if (developerIds.has(id) && developerIds.size <= 1) {
      skipped.push({ user_id: id, reason: "Cannot delete the last remaining developer account." });
      continue;
    }
    if (inFlight.has(id)) {
      skipped.push({ user_id: id, reason: "A deletion for this account is already in progress." });
      continue;
    }
    targets.push(id);
  }

  const deleted: string[] = [];
  const failed: Array<{ user_id: string; error: string }> = [];
  const orphanedTables = new Set<string>();

  for (const id of targets) inFlight.add(id);
  try {
    for (const id of targets) {
      try {
        const remaining = await deleteUserOwnedData(admin, id);
        remaining.forEach((t) => orphanedTables.add(t));
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) {
          failed.push({ user_id: id, error: error.message });
          continue;
        }
        deleted.push(id);
      } catch (err) {
        failed.push({ user_id: id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    for (const id of targets) inFlight.delete(id);
  }

  return jsonResponse(req, {
    ok: failed.length === 0,
    deleted,
    skipped,
    failed,
    orphaned_tables: Array.from(orphanedTables),
  });
}

Deno.serve(handler);
