import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AppRole = "admin" | "super_admin";

type AuthUserSummary = {
  id: string;
  created_at?: string;
  last_sign_in_at?: string | null;
};

type TaxSettingsRow = {
  user_id: string;
  onboarding_complete: boolean | null;
  income_profile_type: string | null;
  subscription_tier: string | null;
  enabled_deduction_types: string[] | null;
  household_w2_income_enabled: boolean | null;
  household_spouse_w2_income_enabled: boolean | null;
  household_additional_w2_job_enabled: boolean | null;
  household_business_1099_income_enabled: boolean | null;
  household_k1_partnership_income_enabled: boolean | null;
  household_scorp_income_enabled: boolean | null;
  household_rental_income_enabled: boolean | null;
};

type CompanyRow = {
  user_id: string;
  company_type: string | null;
  source_kind: string | null;
};

type StreamRow = {
  user_id: string;
  company_type: string | null;
  is_active: boolean | null;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function rate(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function isW2Type(value?: string | null) {
  return ["w2", "w-2", "w_2"].includes((value || "").toLowerCase().trim());
}

function isBusinessType(value?: string | null) {
  return new Set([
    "1099",
    "1099_schedule_c",
    "schedule_c",
    "k1",
    "k1_partnership",
    "scorp",
    "s_corp",
    "scorp_distribution",
    "rental",
  ]).has((value || "").toLowerCase().trim());
}

async function fetchAllRows<T>(queryFactory: () => any, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await queryFactory().range(from, to);
    if (error) throw error;

    const page = (data || []) as T[];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

async function listAllUsers(admin: any): Promise<AuthUserSummary[]> {
  const users: AuthUserSummary[] = [];
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const batch = (data?.users || []) as AuthUserSummary[];
    users.push(...batch.map((user) => ({
      id: user.id,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
    })));

    if (batch.length < perPage) break;
  }

  return users;
}

async function hasAdminRole(admin: any, userId: string, role: AppRole) {
  const { data, error } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: role,
  });

  if (error) throw error;
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);

    if (authError || !authData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const callerUserId = authData.user.id;

    const [isAdmin, isSuperAdmin] = await Promise.all([
      hasAdminRole(admin, callerUserId, "admin"),
      hasAdminRole(admin, callerUserId, "super_admin"),
    ]);

    if (!isAdmin && !isSuperAdmin) return jsonResponse({ error: "Forbidden" }, 403);

    const now = Date.now();
    const daysAgo = (days: number) => now - days * 24 * 60 * 60 * 1000;

    const [users, taxSettings, companies, streams, plaidItems, homeOfficeRows, retirementRows, hsaRows, stockRows, mileageRows] = await Promise.all([
      listAllUsers(admin),
      fetchAllRows<TaxSettingsRow>(() => admin
        .from("tax_settings")
        .select("user_id,onboarding_complete,income_profile_type,subscription_tier,enabled_deduction_types,household_w2_income_enabled,household_spouse_w2_income_enabled,household_additional_w2_job_enabled,household_business_1099_income_enabled,household_k1_partnership_income_enabled,household_scorp_income_enabled,household_rental_income_enabled")),
      fetchAllRows<CompanyRow>(() => admin.from("companies").select("user_id,company_type,source_kind")),
      fetchAllRows<StreamRow>(() => admin.from("projected_income_streams").select("user_id,company_type,is_active")),
      fetchAllRows<{ user_id: string }>(() => admin.from("plaid_items").select("user_id").eq("status", "active")),
      fetchAllRows<{ user_id: string }>(() => admin.from("home_office_deductions").select("user_id")),
      fetchAllRows<{ user_id: string }>(() => admin.from("retirement_contributions").select("user_id")),
      fetchAllRows<{ user_id: string }>(() => admin.from("hsa_contributions").select("user_id")),
      fetchAllRows<{ user_id: string }>(() => admin.from("stock_transactions").select("user_id")),
      fetchAllRows<{ user_id: string }>(() => admin.from("mileage_entries").select("user_id")),
    ]);

    const totalUsers = users.length;
    const activeUsers30d = users.filter((user) => user.last_sign_in_at && Date.parse(user.last_sign_in_at) >= daysAgo(30)).length;
    const newUsers7d = users.filter((user) => user.created_at && Date.parse(user.created_at) >= daysAgo(7)).length;
    const newUsers30d = users.filter((user) => user.created_at && Date.parse(user.created_at) >= daysAgo(30)).length;

    const premiumUsersSet = new Set(
      taxSettings
        .filter((row) => (row.subscription_tier || "").toLowerCase() === "premium")
        .map((row) => row.user_id),
    );
    const freeUsersSet = new Set(
      users
        .map((user) => user.id)
        .filter((userId) => !premiumUsersSet.has(userId)),
    );

    const usersByType: Record<string, number> = {};
    for (const row of taxSettings) {
      const key = (row.income_profile_type || "unknown").trim() || "unknown";
      usersByType[key] = (usersByType[key] || 0) + 1;
    }
    if (totalUsers > taxSettings.length) usersByType.unknown = (usersByType.unknown || 0) + (totalUsers - taxSettings.length);

    const w2Users = new Set<string>();
    const businessUsers = new Set<string>();
    const deductionUsers = new Set<string>();
    const plannedIncomeUsers = new Set<string>();
    const plaidUsers = new Set(plaidItems.map((row) => row.user_id));

    for (const row of taxSettings) {
      if (row.household_w2_income_enabled || row.household_spouse_w2_income_enabled || row.household_additional_w2_job_enabled) {
        w2Users.add(row.user_id);
      }
      if (row.household_business_1099_income_enabled || row.household_k1_partnership_income_enabled || row.household_scorp_income_enabled || row.household_rental_income_enabled) {
        businessUsers.add(row.user_id);
      }
      if ((row.enabled_deduction_types || []).length > 0) deductionUsers.add(row.user_id);
    }

    for (const row of companies) {
      if (isW2Type(row.company_type) || isW2Type(row.source_kind)) w2Users.add(row.user_id);
      if (isBusinessType(row.company_type) || isBusinessType(row.source_kind)) businessUsers.add(row.user_id);
    }

    for (const row of streams) {
      if (row.is_active === false) continue;
      plannedIncomeUsers.add(row.user_id);
      if (isW2Type(row.company_type)) w2Users.add(row.user_id);
      if (isBusinessType(row.company_type)) businessUsers.add(row.user_id);
    }

    for (const row of [...homeOfficeRows, ...retirementRows, ...hsaRows, ...stockRows, ...mileageRows]) {
      deductionUsers.add(row.user_id);
    }

    const completedOnboarding = taxSettings.filter((row) => row.onboarding_complete === true).length;

    return jsonResponse({
      total_users: totalUsers,
      active_users_30d: activeUsers30d,
      new_users_7d: newUsers7d,
      new_users_30d: newUsers30d,
      free_users: freeUsersSet.size,
      premium_users: premiumUsersSet.size,
      users_by_type: usersByType,
      onboarding_completion_rate: rate(completedOnboarding, totalUsers),
      premium_conversion_rate: rate(premiumUsersSet.size, totalUsers),
      users_with_w2_income: w2Users.size,
      users_with_business_income: businessUsers.size,
      users_with_deductions: deductionUsers.size,
      users_with_plaid_connected: plaidUsers.size,
      users_with_planned_income: plannedIncomeUsers.size,
    });
  } catch (error) {
    console.error("admin-metrics error", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
