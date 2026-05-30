// Account cleanup edge function.
// Permanently deletes all user-owned data and the auth account itself.
// Scoped strictly to the authenticated caller's user_id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const STEP_TIMEOUT_MS = 4_000;
const AUTH_TIMEOUT_MS = 8_000;
const STORAGE_TIMEOUT_MS = 1_500;

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
  "user_roles",
] as const;

type CleanupFailure = { step: string; table?: string; error: string; code?: string };
type CleanupWarning = CleanupFailure;

class CleanupStepError extends Error {
  step: string;
  table?: string;
  code?: string;

  constructor(step: string, message: string, opts: { table?: string; code?: string } = {}) {
    super(message);
    this.name = "CleanupStepError";
    this.step = step;
    this.table = opts.table;
    this.code = opts.code;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isSchemaDriftError(error: any) {
  const code = error?.code;
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "42703" || message.includes("does not exist") || message.includes("column");
}

async function withTimeout<T>(step: string, promise: Promise<T>, timeoutMs = STEP_TIMEOUT_MS): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new CleanupStepError(step, `${step} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function createTimedFetch(timeoutMs = STEP_TIMEOUT_MS): typeof fetch {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

function logStep(step: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event: "account-cleanup", step, ...details }));
}

async function deleteStorageForUser(admin: any, userId: string): Promise<CleanupWarning[]> {
  const bucket = "transaction-attachments";
  const warnings: CleanupWarning[] = [];
  try {
    const { data: top, error } = await withTimeout(
      "storage.listRoot",
      admin.storage.from(bucket).list(userId, { limit: 1000 }),
      STORAGE_TIMEOUT_MS,
    );
    if (error || !top) {
      if (error) warnings.push({ step: "storage.listRoot", error: error.message || String(error) });
      return warnings;
    }
    const paths: string[] = [];
    for (const entry of top) {
      if (!entry?.name) continue;
      const inner = await withTimeout(
        "storage.listNested",
        admin.storage.from(bucket).list(`${userId}/${entry.name}`, { limit: 1000 }),
        STORAGE_TIMEOUT_MS,
      );
      if (inner.data) {
        for (const f of inner.data) {
          if (f?.name) paths.push(`${userId}/${entry.name}/${f.name}`);
        }
      } else if ((entry as any).id) {
        paths.push(`${userId}/${entry.name}`);
      }
    }
    if (paths.length) {
      const { error: removeError } = await withTimeout(
        "storage.remove",
        admin.storage.from(bucket).remove(paths),
        STORAGE_TIMEOUT_MS,
      );
      if (removeError) warnings.push({ step: "storage.remove", error: removeError.message || String(removeError) });
    }
  } catch (err) {
    console.warn("account-cleanup storage cleanup skipped", err);
    warnings.push({ step: "storage.cleanup", error: errorMessage(err) });
  }
  return warnings;
}

export async function deleteUserData(admin: any, userId: string) {
  const errors: CleanupFailure[] = [];
  const warnings: CleanupWarning[] = [];

  const { data: orgRows, error: orgLookupError } = await withTimeout(
    "organizations.lookup",
    admin.from("organizations").select("id").eq("owner_user_id", userId),
  );
  if (orgLookupError) {
    console.warn("account-cleanup organization lookup failed", orgLookupError);
    warnings.push({ step: "organizations.lookup", table: "organizations", error: orgLookupError.message || String(orgLookupError), code: orgLookupError.code });
  }
  const ownedOrgIds = ((orgRows || []) as Array<{ id: string }>).map((row) => row.id).filter(Boolean);

  for (const table of USER_SCOPED_FINANCIAL_TABLES) {
    const { error } = await withTimeout(
      `table.${table}`,
      admin.from(table).delete().eq("user_id", userId),
    );
    if (error) {
      console.warn(`account-cleanup delete ${table} failed`, error);
      const failure = { step: `table.${table}`, table, error: error.message || String(error), code: error.code };
      if (isSchemaDriftError(error)) warnings.push(failure);
      else errors.push(failure);
    }
  }

  try {
    warnings.push(...await withTimeout("storage.bestEffort", deleteStorageForUser(admin, userId), STORAGE_TIMEOUT_MS));
  } catch (err) {
    console.warn("account-cleanup storage cleanup did not finish before continuing", err);
    warnings.push({ step: "storage.bestEffort", error: errorMessage(err) });
  }

  // Profile row will cascade with the auth user; delete proactively to keep
  // org membership tidy if any FK is missing.
  const { error: orgMemErr } = await withTimeout("table.organization_members", admin
    .from("organization_members")
    .delete()
    .eq("user_id", userId));
  if (orgMemErr) errors.push({ step: "table.organization_members", table: "organization_members", error: orgMemErr.message, code: orgMemErr.code });

  const { error: profErr } = await withTimeout("table.profiles", admin
    .from("profiles")
    .delete()
    .eq("user_id", userId));
  if (profErr) errors.push({ step: "table.profiles", table: "profiles", error: profErr.message, code: profErr.code });

  if (ownedOrgIds.length > 0) {
    const { error: orgDeleteErr } = await withTimeout(
      "table.organizations",
      admin.from("organizations").delete().in("id", ownedOrgIds),
    );
    if (orgDeleteErr) warnings.push({ step: "table.organizations", table: "organizations", error: orgDeleteErr.message, code: orgDeleteErr.code });
  }

  if (errors.length > 0) {
    throw new CleanupStepError(errors[0].step, `Account delete did not fully complete at ${errors[0].step}: ${errors[0].error}`, { table: errors[0].table, code: errors[0].code });
  }

  return { warnings, deletedOrganizations: ownedOrgIds.length };
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
      global: { fetch: createTimedFetch(STEP_TIMEOUT_MS) },
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

    let cleanupResult: Awaited<ReturnType<typeof deleteUserData>>;
    try {
      cleanupResult = await deleteUserData(admin, userId);
    } catch (deleteError) {
      console.error("account-cleanup data delete failed", deleteError);
      return jsonResponse(req, {
        ok: false,
        error: "Failed to delete account data",
        failedStep: (deleteError as CleanupStepError).step || "deleteUserData",
        failedTable: (deleteError as CleanupStepError).table || null,
        detail: (deleteError as Error).message,
      }, 500);
    }

    const { error: authDelErr } = await withTimeout(
      "auth.deleteUser",
      admin.auth.admin.deleteUser(userId),
    );
    if (authDelErr) {
      console.error("account-cleanup deleteUser failed", authDelErr);
      return jsonResponse(req, {
        ok: false,
        error: "Failed to delete auth user",
        failedStep: "auth.deleteUser",
        detail: authDelErr.message,
      }, 500);
    }

    return jsonResponse(req, { ok: true, action: "delete", cleanup: cleanupResult });
  } catch (error) {
    console.error("account-cleanup error", error);
    return jsonResponse(req, {
      ok: false,
      error: "Internal error",
      failedStep: (error as CleanupStepError).step || "handler",
      failedTable: (error as CleanupStepError).table || null,
      detail: (error as Error).message,
    }, 500);
  }
}

Deno.serve(handler);
