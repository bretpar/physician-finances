// Admin-only data isolation report. Uses the service role to bypass RLS so it
// can audit the actual on-disk state, then returns aggregate counts and
// per-table flags. Caller must be an authenticated user with the 'admin' role
// in public.user_roles.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TABLES = [
  "companies", "home_office_deductions", "hsa_contributions", "income_entries",
  "income_forecasts", "income_pathway_history", "investment_income_entries",
  "mileage_entries", "plaid_accounts", "plaid_items", "plaid_transactions",
  "planner_conversions", "profiles", "projected_bonus_events",
  "projected_income_overrides", "projected_income_streams",
  "retirement_contributions", "stock_transactions", "tax_payments",
  "tax_savings", "tax_settings", "transaction_attachments", "transaction_links",
  "transactions", "ytd_catchup_entries",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller + admin role using their JWT
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .in("role", ["admin", "super_admin"])
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — admin role required" }, 403);

    // Build the report
    const report: Record<string, unknown> = {};
    for (const table of TABLES) {
      try {
        const { count: total } = await admin.from(table).select("*", { count: "exact", head: true });

        const { count: nullUser } = await admin
          .from(table).select("*", { count: "exact", head: true })
          .is("user_id", null);

        const { count: nullOrg } = await admin
          .from(table).select("*", { count: "exact", head: true })
          .is("organization_id", null);

        // Cross-org leak: rows whose organization_id is NOT in the row owner's org membership.
        // We pull a sample (≤2000) and check membership in JS to avoid heavy server joins.
        const { data: sample } = await admin
          .from(table)
          .select("id, user_id, organization_id")
          .not("organization_id", "is", null)
          .limit(2000);

        let crossOrgLeak = 0;
        const leakIds: string[] = [];
        if (sample && sample.length) {
          const userIds = [...new Set(sample.map((r: any) => r.user_id).filter(Boolean))];
          const { data: memberships } = await admin
            .from("organization_members")
            .select("user_id, organization_id")
            .in("user_id", userIds as string[]);
          const memberSet = new Set((memberships ?? []).map((m: any) => `${m.user_id}:${m.organization_id}`));
          for (const r of sample as any[]) {
            if (!memberSet.has(`${r.user_id}:${r.organization_id}`)) {
              crossOrgLeak++;
              if (leakIds.length < 25) leakIds.push(r.id);
            }
          }
        }

        report[table] = {
          total: total ?? 0,
          null_user_id: nullUser ?? 0,
          null_organization_id: nullOrg ?? 0,
          cross_org_rows: crossOrgLeak,
          cross_org_sample_ids: leakIds,
          ok: (nullUser ?? 0) === 0 && crossOrgLeak === 0,
        };
      } catch (e) {
        report[table] = { error: (e as Error).message };
      }
    }

    return json({ generated_at: new Date().toISOString(), tables: report }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
