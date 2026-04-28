import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

type AppRole = "user" | "admin" | "super_admin";
type AdminRole = "admin" | "super_admin";
type UserType = "w2_only" | "w2_1099_k1" | "1099_k1_only" | "unknown";
type Plan = "free" | "premium";

type AuthUserSummary = {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
};

type TaxSettingsRow = {
  user_id: string;
  onboarding_complete: boolean | null;
  income_profile_type: string | null;
  subscription_tier: string | null;
  household_w2_income_enabled?: boolean | null;
  household_spouse_w2_income_enabled?: boolean | null;
  household_additional_w2_job_enabled?: boolean | null;
  household_business_1099_income_enabled?: boolean | null;
  household_k1_partnership_income_enabled?: boolean | null;
  household_scorp_income_enabled?: boolean | null;
  household_rental_income_enabled?: boolean | null;
};

type UserRoleRow = {
  user_id: string;
  role: AppRole;
};

const MAX_USERS = 1000;

function normalizePlan(value?: string | null): Plan {
  return (value || "").toLowerCase() === "premium" ? "premium" : "free";
}

function mapUserType(settings?: TaxSettingsRow): UserType {
  const profile = (settings?.income_profile_type || "").trim();
  if (profile === "w2_only") return "w2_only";
  if (profile === "w2_plus_business") return "w2_1099_k1";
  if (profile === "business_only") return "1099_k1_only";

  const hasW2 = Boolean(settings?.household_w2_income_enabled || settings?.household_spouse_w2_income_enabled || settings?.household_additional_w2_job_enabled);
  const hasBusiness = Boolean(settings?.household_business_1099_income_enabled || settings?.household_k1_partnership_income_enabled || settings?.household_scorp_income_enabled || settings?.household_rental_income_enabled);

  if (hasW2 && hasBusiness) return "w2_1099_k1";
  if (hasW2) return "w2_only";
  if (hasBusiness) return "1099_k1_only";
  return "unknown";
}

function highestRole(roles: AppRole[]): AppRole {
  if (roles.includes("super_admin")) return "super_admin";
  if (roles.includes("admin")) return "admin";
  return "user";
}

async function hasAdminRole(admin: any, userId: string, role: AdminRole) {
  const { data, error } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: role,
  });

  if (error) throw error;
  return data === true;
}

async function requireAdmin(req: Request, admin: any) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { error: jsonResponse(req, { error: "Unauthorized" }, 401) };

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { error: jsonResponse(req, { error: "Unauthorized" }, 401) };

  const [isAdmin, isSuperAdmin] = await Promise.all([
    hasAdminRole(admin, data.user.id, "admin"),
    hasAdminRole(admin, data.user.id, "super_admin"),
  ]);

  if (!isAdmin && !isSuperAdmin) return { error: jsonResponse(req, { error: "Unauthorized" }, 403) };
  return { user: data.user };
}

async function listUsers(admin: any): Promise<AuthUserSummary[]> {
  const users: AuthUserSummary[] = [];
  const perPage = 100;

  for (let page = 1; users.length < MAX_USERS; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const batch = (data?.users || []) as AuthUserSummary[];
    users.push(...batch.slice(0, MAX_USERS - users.length));
    if (batch.length < perPage) break;
  }

  return users;
}

async function fetchSafe<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    console.warn("admin-list-users optional query skipped", error);
    return [];
  }
  return data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "GET") return jsonResponse(req, { error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(req, { error: "Server configuration error" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const auth = await requireAdmin(req, admin);
    if (auth.error) return auth.error;

    const [authUsers, taxSettings, userRoles] = await Promise.all([
      listUsers(admin),
      fetchSafe<TaxSettingsRow>(admin
        .from("tax_settings")
        .select("user_id,onboarding_complete,income_profile_type,subscription_tier,household_w2_income_enabled,household_spouse_w2_income_enabled,household_additional_w2_job_enabled,household_business_1099_income_enabled,household_k1_partnership_income_enabled,household_scorp_income_enabled,household_rental_income_enabled")
        .limit(MAX_USERS)),
      fetchSafe<UserRoleRow>(admin.from("user_roles").select("user_id,role")),
    ]);

    const settingsByUser = new Map(taxSettings.map((row) => [row.user_id, row]));
    const rolesByUser = new Map<string, AppRole[]>();
    for (const row of userRoles) {
      const roles = rolesByUser.get(row.user_id) || [];
      roles.push(row.role);
      rolesByUser.set(row.user_id, roles);
    }

    return jsonResponse(req, {
      users: authUsers.map((user) => {
        const settings = settingsByUser.get(user.id);
        return {
          id: user.id,
          email: user.email || null,
          created_at: user.created_at || null,
          plan: normalizePlan(settings?.subscription_tier),
          role: highestRole(rolesByUser.get(user.id) || ["user"]),
          user_type: mapUserType(settings),
          onboarding_completed: settings?.onboarding_complete ?? null,
          last_active_at: user.last_sign_in_at || null,
        };
      }),
    });
  } catch (error) {
    console.error("admin-list-users error", error);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
