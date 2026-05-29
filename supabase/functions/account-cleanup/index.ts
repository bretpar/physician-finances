// Account cleanup edge function. Supports two actions:
// - "erase":   wipes all app data for the calling user but keeps the auth account.
//              Resets tax_settings + onboarding flags so the user starts at onboarding again.
// - "delete":  performs an erase, then deletes the auth user (permanent).
//
// Both actions are scoped to the caller's user_id and are idempotent.
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
] as const;

export const SAFE_ERASE_STORAGE_PREFIXES = ["paycheckmd-", "paycheckmd:", "w4."] as const;

export function buildTaxSettingsReset(userId: string, organizationId: string | null) {
  return {
    user_id: userId,
    organization_id: organizationId,
    filing_status: "single",
    last_year_tax: 0,
    standard_deduction_override: null,
    ss_wage_cap: 168600,
    tax_mode: "projected_brackets",
    manual_effective_tax_rate: null,
    withholding_method: "dynamic_planner",
    deduction_type: "standard",
    itemized_deduction_amount: 0,
    qualifying_children_count: 0,
    other_dependents_count: 0,
    withholding_override_type: "none",
    withholding_override_percent: null,
    withholding_override_amount: null,
    state_tax_enabled: false,
    state_income_tax_enabled: false,
    state_of_residence: "",
    personal_state_tax_mode: "none",
    personal_state_tax_rate: 0,
    personal_state_tax_annual_estimate: 0,
    business_state_tax_enabled: false,
    business_state_tax_rate: 0,
    business_state_tax_base: "net_profit",
    business_state_tax_application_mode: "all_business",
    business_state_tax_company_ids: [],
    hsa_enabled: false,
    hsa_source_company_id: null,
    auto_convert_future_income_to_ledger: false,
    quarterly_tracker_method: "even",
    household_w2_income_enabled: true,
    household_spouse_w2_income_enabled: true,
    household_additional_w2_job_enabled: true,
    household_business_1099_income_enabled: true,
    household_k1_partnership_income_enabled: true,
    household_scorp_income_enabled: true,
    household_rental_income_enabled: true,
    household_investment_income_enabled: true,
    household_other_income_enabled: true,
    onboarding_complete: false,
    onboarding_step: 1,
    onboarding_banner_dismissed: false,
    onboarding_first_name: "",
    income_profile_type: "w2_plus_business",
    enabled_income_sources: { w2: true, form1099: true, k1: true },
    enabled_personal_income_types: [],
    tax_recommendation_method: "dynamic_planner",
    flat_federal_rate: null,
    flat_state_rate: null,
    deduction_strategy: "standard",
    enabled_deduction_types: [],
    subscription_tier: "premium",
    ytd_catchup_choice: null,
    timezone: null,
  };
}

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

export async function eraseUserData(admin: any, userId: string) {
  const errors: { table: string; error: string }[] = [];

  for (const table of USER_SCOPED_FINANCIAL_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) {
      console.warn(`account-cleanup delete ${table} failed`, error);
      errors.push({ table, error: error.message || String(error) });
    }
  }

  await deleteStorageForUser(admin, userId);

  // Reset tax_settings in place so the route guard's canonical
  // onboarding_complete flag is guaranteed to become false for this account.
  // Preserve organization_id so the user remains in their org.
  const { data: existing } = await admin
    .from("tax_settings")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  const orgId = existing?.organization_id ?? null;

  const taxSettingsReset = buildTaxSettingsReset(userId, orgId);

  const { error: upsertTs } = await admin
    .from("tax_settings")
    .upsert(taxSettingsReset, { onConflict: "user_id" });
  if (upsertTs) errors.push({ table: "tax_settings(reset)", error: upsertTs.message });

  const { error: profileReset } = await admin
    .from("profiles")
    .update({ first_name: "", last_name: "" })
    .eq("user_id", userId);
  if (profileReset) errors.push({ table: "profiles(reset)", error: profileReset.message });

  const blockingErrors = errors.filter((e) => !e.table.startsWith("profiles("));
  if (blockingErrors.length > 0) {
    throw new Error(
      `Safe erase did not complete. Failed tables: ${blockingErrors.map((e) => e.table).join(", ")}`,
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

    if (action !== "erase" && action !== "delete") {
      return jsonResponse(req, { error: "Invalid action" }, 400);
    }

    let errors: { table: string; error: string }[] = [];
    try {
      errors = await eraseUserData(admin, userId);
    } catch (eraseError) {
      console.error("account-cleanup erase failed", eraseError);
      return jsonResponse(req, {
        ok: false,
        error: "Failed to erase account data",
        detail: (eraseError as Error).message,
      }, 500);
    }

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
}

if (import.meta.main) {
  Deno.serve(handler);
}
