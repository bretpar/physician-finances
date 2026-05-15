// test-seed-users — token-gated test fixture creator.
// Creates 3 deterministic test accounts with realistic May 2026 onboarding
// data so external automation (Codex) can verify the app end-to-end without
// needing direct Supabase Auth access from its environment.
//
// Auth: Authorization: Bearer <TEST_SEED_ADMIN_TOKEN>
// Method: POST  Body: { reset?: boolean } (default true — wipes prior seed)
//
// Disabled in production unless TEST_SEED_ADMIN_TOKEN is set on the project.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SEED_TAG = "[test-seed]";
const SEED_PASSWORD = "TestSeed!2026";

type Persona = {
  email: string;
  label: string;
  incomeProfile: "w2_only" | "w2_plus_business" | "business_only";
  hasW2: boolean;
  has1099: boolean;
};

const PERSONAS: Persona[] = [
  { email: "test-w2@paycheckmd.test", label: "W-2 only", incomeProfile: "w2_only", hasW2: true, has1099: false },
  { email: "test-w2-1099@paycheckmd.test", label: "W-2 + 1099", incomeProfile: "w2_plus_business", hasW2: true, has1099: true },
  { email: "test-1099@paycheckmd.test", label: "1099 only", incomeProfile: "business_only", hasW2: false, has1099: true },
];

const TEST_EMAIL_DOMAIN = "@paycheckmd.test";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const adminToken = Deno.env.get("TEST_SEED_ADMIN_TOKEN");
  if (!adminToken) return json({ error: "Test seed harness disabled (TEST_SEED_ADMIN_TOKEN not set)" }, 503);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== adminToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const reset: boolean = body?.reset !== false;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const results: any[] = [];

  for (const p of PERSONAS) {
    try {
      // Safety: refuse to act on anything outside the test domain.
      if (!p.email.endsWith(TEST_EMAIL_DOMAIN)) {
        results.push({ email: p.email, error: "Refused: not a test domain" });
        continue;
      }

      // 1. Create or fetch user.
      let userId: string | null = null;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: p.email,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { first_name: p.label, test_seed: true },
      });
      if (created?.user) {
        userId = created.user.id;
      } else if (createErr) {
        // Already exists — find by listing.
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list?.users.find((u) => u.email?.toLowerCase() === p.email);
        if (!existing) throw createErr;
        userId = existing.id;
        // Reset password so the documented credential always works.
        await admin.auth.admin.updateUserById(userId, { password: SEED_PASSWORD, email_confirm: true });
      }
      if (!userId) throw new Error("Could not resolve user id");

      // 2. Wait briefly for handle_new_user trigger to provision rows.
      let settings: any = null;
      let orgId: string | null = null;
      for (let i = 0; i < 10; i++) {
        const { data } = await admin.from("tax_settings").select("*").eq("user_id", userId).maybeSingle();
        if (data) { settings = data; orgId = data.organization_id; break; }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!settings) throw new Error("tax_settings not provisioned");

      // 3. Wipe prior seed rows (idempotent).
      if (reset) {
        const tables = [
          "investment_income_entries",
          "income_entries",
          "projected_income_streams",
          "companies",
        ];
        for (const t of tables) {
          await admin.from(t).delete().eq("user_id", userId).like("notes", `%${SEED_TAG}%`);
        }
      }

      // 4. Update tax_settings — premium, onboarded, filing married, WA state off.
      await admin.from("tax_settings").update({
        subscription_tier: "premium",
        onboarding_complete: true,
        onboarding_first_name: p.label,
        filing_status: "married_jointly",
        income_profile_type: p.incomeProfile,
        household_w2_income_enabled: p.hasW2,
        household_business_1099_income_enabled: p.has1099,
        household_investment_income_enabled: true,
        state_tax_enabled: false,
        last_year_tax: 60000,
      }).eq("user_id", userId);

      // 5. Seed companies.
      const companies: { id: string; type: "w2" | "1099" }[] = [];
      if (p.hasW2) {
        const { data: w2co } = await admin.from("companies").insert({
          user_id: userId,
          organization_id: orgId,
          name: "Seed Hospital W-2",
          nickname: "Seed Hospital",
          company_type: "w2",
          source_kind: "w2",
          notes: SEED_TAG,
        }).select("id").single();
        if (w2co) companies.push({ id: w2co.id, type: "w2" });
      }
      if (p.has1099) {
        const { data: bizco } = await admin.from("companies").insert({
          user_id: userId,
          organization_id: orgId,
          name: "Seed Locums 1099",
          nickname: "Seed Locums",
          company_type: "1099_schedule_c",
          source_kind: "1099_schedule_c",
          notes: SEED_TAG,
        }).select("id").single();
        if (bizco) companies.push({ id: bizco.id, type: "1099" });
      }

      // 6. Seed YTD income entries for May 2026.
      const incomeRows: any[] = [];
      if (p.hasW2) {
        // Two W-2 paychecks YTD ($10k each, gross), plus a YTD catch-up sum entry.
        for (const date of ["2026-04-15", "2026-04-30"]) {
          incomeRows.push({
            user_id: userId, organization_id: orgId,
            name: "Bi-weekly paycheck", company: "Seed Hospital",
            income_type: "w2", source_bucket: "personal", entry_kind: "regular_paycheck",
            income_date: date,
            gross_amount: 10000, paycheck_amount: 7200, deposited_amount: 7200,
            taxes_withheld: 2200, federal_withholding: 1700, state_withholding: 0,
            ss_withholding: 620, medicare_withholding: 145,
            retirement_401k: 500, healthcare_deduction: 100,
            include_in_tax_estimate: true, status: "received",
            notes: SEED_TAG,
          });
        }
        // YTD catch-up summary mirror entry (Jan–March 2026).
        incomeRows.push({
          user_id: userId, organization_id: orgId,
          name: "YTD W-2 catch-up", company: "Seed Hospital",
          income_type: "w2", source_bucket: "personal", entry_kind: "ytd_catchup",
          income_date: "2026-03-31",
          gross_amount: 60000, paycheck_amount: 43000, deposited_amount: 43000,
          taxes_withheld: 13500, federal_withholding: 10500, ss_withholding: 3720, medicare_withholding: 870,
          retirement_401k: 3000, healthcare_deduction: 600,
          include_in_tax_estimate: false, // mirrored — raw YTD aggregated separately
          status: "received",
          notes: `${SEED_TAG} Setup income through May 2026`,
        });
      }
      if (p.has1099) {
        // Two 1099 deposits + a YTD business catch-up.
        for (const [date, amt] of [["2026-04-10", 12000], ["2026-05-01", 9000]] as const) {
          incomeRows.push({
            user_id: userId, organization_id: orgId,
            name: "Locums shift", company: "Seed Locums",
            income_type: "1099_schedule_c", source_bucket: "business", entry_kind: "regular_paycheck",
            income_date: date,
            gross_amount: amt, paycheck_amount: amt, deposited_amount: amt,
            taxes_withheld: 0,
            include_in_tax_estimate: true, status: "received",
            notes: SEED_TAG,
          });
        }
        incomeRows.push({
          user_id: userId, organization_id: orgId,
          name: "YTD 1099 catch-up", company: "Seed Locums",
          income_type: "1099_schedule_c", source_bucket: "business", entry_kind: "ytd_catchup",
          income_date: "2026-03-31",
          gross_amount: 30000, paycheck_amount: 30000, deposited_amount: 30000,
          taxes_withheld: 0,
          include_in_tax_estimate: false,
          status: "received",
          notes: `${SEED_TAG} Setup income through May 2026`,
        });
      }
      if (incomeRows.length) await admin.from("income_entries").insert(incomeRows);

      // 7. Seed projected income streams (future planner entries).
      const streams: any[] = [];
      if (p.hasW2) {
        streams.push({
          user_id: userId, organization_id: orgId,
          company: "Seed Hospital", company_type: "W2",
          pay_frequency: "biweekly", start_date: "2026-05-15",
          paycheck_amount: 7200, taxes_withheld: 2200,
          federal_withholding: 1700, ss_withholding: 620, medicare_withholding: 145,
          retirement_401k: 500, healthcare_deduction: 100,
          is_active: true, include_in_tax: true,
          notes: SEED_TAG,
        });
      }
      if (p.has1099) {
        streams.push({
          user_id: userId, organization_id: orgId,
          company: "Seed Locums", company_type: "1099",
          pay_frequency: "monthly", start_date: "2026-06-01",
          paycheck_amount: 10000, taxes_withheld: 0,
          is_active: true, include_in_tax: true,
          notes: SEED_TAG,
        });
      }
      if (streams.length) await admin.from("projected_income_streams").insert(streams);

      // 8. Seed investment income — one of each bucket plus a small loss.
      await admin.from("investment_income_entries").insert([
        { user_id: userId, organization_id: orgId, entry_date: "2026-03-12",
          investment_income_type: "short_term_sale", asset_name_or_ticker: "TSLA",
          sale_proceeds: 5000, cost_basis: 3000, taxable_amount: 2000,
          is_qualified_dividend: false, notes: SEED_TAG },
        { user_id: userId, organization_id: orgId, entry_date: "2026-02-20",
          investment_income_type: "long_term_sale", asset_name_or_ticker: "AAPL",
          sale_proceeds: 15000, cost_basis: 10000, taxable_amount: 5000,
          is_qualified_dividend: false, notes: SEED_TAG },
        { user_id: userId, organization_id: orgId, entry_date: "2026-04-01",
          investment_income_type: "dividend", asset_name_or_ticker: "VTI",
          taxable_amount: 1200, is_qualified_dividend: true, notes: SEED_TAG },
        { user_id: userId, organization_id: orgId, entry_date: "2026-04-22",
          investment_income_type: "short_term_sale", asset_name_or_ticker: "GME",
          sale_proceeds: 2000, cost_basis: 2800, taxable_amount: -800,
          is_qualified_dividend: false, notes: SEED_TAG },
      ]);

      results.push({
        email: p.email, label: p.label, user_id: userId, organization_id: orgId,
        password: SEED_PASSWORD, premium: true,
        seeded: { companies: companies.length, income_entries: incomeRows.length, streams: streams.length, investment_entries: 4 },
      });
    } catch (e: any) {
      results.push({ email: p.email, error: e?.message || String(e) });
    }
  }

  return json({ ok: true, password: SEED_PASSWORD, users: results });
});
