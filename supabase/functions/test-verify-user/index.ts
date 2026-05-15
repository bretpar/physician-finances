// test-verify-user — token-gated read-back of seeded test data + key totals.
// Auth: Authorization: Bearer <TEST_SEED_ADMIN_TOKEN>
// Method: POST  Body: { email: "test-w2@paycheckmd.test" }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TEST_DOMAIN = "@paycheckmd.test";
const num = (x: any) => Number(x ?? 0);
const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + num(r[k]), 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const adminToken = Deno.env.get("TEST_SEED_ADMIN_TOKEN");
  if (!adminToken) return json({ error: "Test verify harness disabled" }, 503);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== adminToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { email } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string" || !email.endsWith(TEST_DOMAIN)) {
    return json({ error: "Provide a test domain email" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) return json({ error: "User not found" }, 404);

  const [{ data: settings }, { data: incomes }, { data: streams }, { data: investments }, { data: companies }] = await Promise.all([
    admin.from("tax_settings").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("income_entries").select("*").eq("user_id", user.id),
    admin.from("projected_income_streams").select("*").eq("user_id", user.id),
    admin.from("investment_income_entries").select("*").eq("user_id", user.id),
    admin.from("companies").select("id,name,company_type").eq("user_id", user.id),
  ]);

  const inc = incomes ?? [];
  const inv = investments ?? [];

  // Tax-engine relevant aggregates (mirrors how the in-app engine buckets income).
  const w2 = inc.filter((r) => r.source_bucket === "personal" && r.include_in_tax_estimate);
  const biz = inc.filter((r) => r.source_bucket === "business" && r.include_in_tax_estimate);

  const ytd = inc.filter((r) => r.entry_kind === "ytd_catchup");
  const w2_gross = sum(w2, "gross_amount") + sum(ytd.filter((r) => r.source_bucket === "personal"), "gross_amount");
  const biz_gross = sum(biz, "gross_amount") + sum(ytd.filter((r) => r.source_bucket === "business"), "gross_amount");

  const fed_withholding = sum(w2, "federal_withholding") + sum(ytd, "federal_withholding");
  const ss_withholding = sum(w2, "ss_withholding") + sum(ytd, "ss_withholding");
  const medicare_withholding = sum(w2, "medicare_withholding") + sum(ytd, "medicare_withholding");
  const retirement_401k = sum(w2, "retirement_401k") + sum(ytd, "retirement_401k");

  const inv_short = inv.filter((r) => r.investment_income_type === "short_term_sale");
  const inv_long = inv.filter((r) => r.investment_income_type === "long_term_sale");
  const inv_div = inv.filter((r) => r.investment_income_type === "dividend");
  const inv_div_qual = inv_div.filter((r) => r.is_qualified_dividend);
  const inv_div_nonqual = inv_div.filter((r) => !r.is_qualified_dividend);

  return json({
    email,
    user_id: user.id,
    premium: settings?.subscription_tier === "premium",
    filing_status: settings?.filing_status,
    income_profile_type: settings?.income_profile_type,
    onboarding_complete: settings?.onboarding_complete === true,
    state_tax_enabled: settings?.state_tax_enabled === true,
    counts: {
      companies: companies?.length ?? 0,
      income_entries: inc.length,
      ytd_catchup_entries: ytd.length,
      projected_income_streams: streams?.length ?? 0,
      investment_entries: inv.length,
    },
    totals: {
      total_personal_w2_gross: w2_gross,
      total_business_gross: biz_gross,
      total_gross_income: w2_gross + biz_gross,
      total_federal_withholding: fed_withholding,
      total_ss_withholding: ss_withholding,
      total_medicare_withholding: medicare_withholding,
      total_retirement_401k: retirement_401k,
      total_investment_taxable: sum(inv, "taxable_amount"),
      investment_short_term_sales: sum(inv_short, "taxable_amount"),
      investment_long_term_sales: sum(inv_long, "taxable_amount"),
      investment_dividends_qualified: sum(inv_div_qual, "taxable_amount"),
      investment_dividends_nonqualified: sum(inv_div_nonqual, "taxable_amount"),
      investment_recommended_tax: sum(inv, "tax_recommendation"),
    },
    companies: companies ?? [],
  });
});
