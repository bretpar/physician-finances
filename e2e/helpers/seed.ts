/**
 * E2E disposable-user seed helpers.
 *
 * Strategy:
 *   - Sign up a brand-new user via public Supabase Auth (anon key, no service role).
 *   - Wait for the handle_new_user() trigger to provision profile + organization + tax_settings.
 *   - Mark onboarding complete and seed realistic rows through that user's session,
 *     so RLS is exercised end-to-end.
 *
 * Disposable users are tagged with a timestamp and intentionally NOT deleted, per
 * the project's chosen cleanup strategy ("Keep + tag with timestamp").
 * Run scripts/cleanup-e2e-users.ts to inspect / purge later.
 */
import { createRequire } from "node:module";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? "https://fiqnxprhvsadcqicczkg.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcW54cHJodnNhZGNxaWNjemtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NjQ1OTIsImV4cCI6MjA5MTI0MDU5Mn0.zLfB4BgxOjdFt4BYdmIZ_j3UpMkadSiU_LezbC35XP0";

/**
 * Node 20 (and older) does not ship a global `WebSocket` constructor, which
 * supabase-js's realtime client requires at import time. The seed harness
 * never opens realtime channels, but the client still constructs the
 * transport eagerly. Provide a `ws`-backed shim when missing so the import
 * doesn't throw "Node.js 20 detected without native WebSocket support".
 *
 * Browser/spec runs are unaffected — the browser has a native WebSocket and
 * this block is a no-op there.
 */
if (typeof globalThis !== "undefined" && typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  try {
    const nodeRequire = createRequire(import.meta.url);
    const ws = nodeRequire("ws");
    (globalThis as { WebSocket?: unknown }).WebSocket = ws.WebSocket ?? ws;
  } catch {
    // If `ws` isn't installed, fall through — createClient below disables
    // realtime auto-connect so the missing global won't be exercised.
  }
}

export const E2E_EMAIL_DOMAIN = "paycheckmd-e2e.test";
export const E2E_PASSWORD = "Test1234!";

export interface DisposableUser {
  email: string;
  password: string;
  userId: string;
  organizationId: string;
  client: SupabaseClient;
  /** Seeded fixture totals — used by spec assertions. */
  fixtures: SeededFixtures;
}

export interface SeededFixtures {
  companyId: string;
  /** Sum of seeded 1099 income paychecks for the year. */
  businessGrossIncome: number;
  /** Sum of seeded business expense transactions. */
  businessExpensesTotal: number;
  /** Net business profit (gross - expenses). */
  businessNetProfit: number;
  /** YTD catch-up gross used in tax engine. */
  ytdCatchupGross: number;
  /** Per-period forecast expense on projected stream. */
  projectedForecastExpensePerPeriod: number;
}

function buildEmail(label: string): string {
  // RFC-compliant disposable address. Non-deliverable .test TLD on purpose.
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e+${label}-${ts}-${rand}@${E2E_EMAIL_DOMAIN}`;
}

async function waitForProvisioning(
  client: SupabaseClient,
  userId: string,
  timeoutMs = 15_000,
): Promise<{ organizationId: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await client
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.organization_id) return { organizationId: data.organization_id };
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`handle_new_user provisioning timed out for ${userId}`);
}

/** Create a fresh Supabase client + signed-in disposable user. */
export async function createDisposableUser(label = "user"): Promise<{
  client: SupabaseClient;
  email: string;
  password: string;
  userId: string;
  organizationId: string;
}> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = buildEmail(label);
  const password = E2E_PASSWORD;

  const { data: signUp, error: signUpErr } = await client.auth.signUp({
    email,
    password,
    options: { data: { first_name: "E2E" } },
  });
  if (signUpErr) throw new Error(`signUp failed: ${signUpErr.message}`);
  // With auto-confirm enabled signUp returns a session; if not, sign in.
  if (!signUp.session) {
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn after signUp failed: ${signInErr.message}`);
  }
  const userId = signUp.user?.id;
  if (!userId) throw new Error("signUp returned no user id");

  const { organizationId } = await waitForProvisioning(client, userId);
  return { client, email, password, userId, organizationId };
}

/** Mark onboarding complete via direct table update (bypasses UI clicks). */
export async function completeOnboarding(
  client: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const { error } = await client
    .from("tax_settings")
    .update({
      onboarding_complete: true,
      onboarding_step: 3,
      onboarding_first_name: "E2E",
      filing_status: "single",
      state_tax_enabled: true,
      state_of_residence: "WA",
      personal_state_tax_mode: "none",
      business_state_tax_enabled: true,
      business_state_tax_rate: 0.00484, // WA B&O service rate
      business_state_tax_base: "gross",
      business_state_tax_application_mode: "all_business",
      income_profile_type: "business_only",
      tax_recommendation_method: "dynamic_planner",
      withholding_method: "dynamic_actual",
    })
    .eq("organization_id", organizationId);
  if (error) throw new Error(`completeOnboarding update failed: ${error.message}`);
}

/** Seed realistic rows: company, 1099 income, business expense, projected stream, YTD catch-up. */
export async function seedFixtures(
  client: SupabaseClient,
  userId: string,
  organizationId: string,
): Promise<SeededFixtures> {
  const year = new Date().getFullYear();
  const isoToday = new Date().toISOString().slice(0, 10);

  // 1) Company
  const { data: company, error: cErr } = await client
    .from("companies")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      name: "E2E Locums Group",
      nickname: "E2E Locums",
      company_type: "1099_schedule_c",
      source_kind: "1099_schedule_c",
      include_in_tax: true,
      include_se_tax_in_recommendation: true,
      apply_business_state_tax: true,
    })
    .select("id")
    .single();
  if (cErr || !company) throw new Error(`company insert failed: ${cErr?.message}`);
  const companyId = company.id;

  // 2) Two 1099 income paychecks ($25k each = $50k gross)
  const paycheckAmount = 25_000;
  const businessGrossIncome = paycheckAmount * 2;
  const incomeRows = [
    {
      user_id: userId,
      organization_id: organizationId,
      name: "E2E Locums Payment 1",
      company: "E2E Locums Group",
      income_type: "1099_schedule_c",
      ui_income_subtype: "1099",
      income_date: `${year}-03-15`,
      paycheck_amount: paycheckAmount,
      gross_amount: paycheckAmount,
      deposited_amount: paycheckAmount,
      source_bucket: "business",
      source_id: companyId,
      include_in_tax_estimate: true,
      include_in_cash_flow: false,
      is_actual: true,
      status: "received",
    },
    {
      user_id: userId,
      organization_id: organizationId,
      name: "E2E Locums Payment 2",
      company: "E2E Locums Group",
      income_type: "1099_schedule_c",
      ui_income_subtype: "1099",
      income_date: `${year}-06-15`,
      paycheck_amount: paycheckAmount,
      gross_amount: paycheckAmount,
      deposited_amount: paycheckAmount,
      source_bucket: "business",
      source_id: companyId,
      include_in_tax_estimate: true,
      include_in_cash_flow: false,
      is_actual: true,
      status: "received",
    },
  ];
  const { error: iErr } = await client.from("income_entries").insert(incomeRows);
  if (iErr) throw new Error(`income_entries insert failed: ${iErr.message}`);

  // 3) Business expense transaction ($8k)
  const businessExpensesTotal = 8_000;
  const { error: tErr } = await client.from("transactions").insert({
    user_id: userId,
    organization_id: organizationId,
    transaction_date: `${year}-04-10`,
    vendor: "E2E Medical Supplies",
    amount: businessExpensesTotal,
    transaction_type: "expense",
    category: "Supplies",
    schedule_c_category: "supplies",
    entity: "E2E Locums Group",
    company_type: "1099_schedule_c",
    source_id: companyId,
    source_type: "manual",
    status: "active",
    origin_type: "manual",
    match_status: "unmatched",
  });
  if (tErr) throw new Error(`transactions insert failed: ${tErr.message}`);

  // 4) Projected income stream (1099) with forecast expense per period
  const projectedForecastExpensePerPeriod = 1_500;
  const { error: pErr } = await client.from("projected_income_streams").insert({
    user_id: userId,
    organization_id: organizationId,
    company: "E2E Locums Group",
    company_type: "1099",
    ui_income_subtype: "1099",
    pay_frequency: "monthly",
    start_date: `${year}-09-01`,
    end_date: `${year}-12-31`,
    paycheck_amount: 10_000,
    taxes_withheld: 0,
    is_active: true,
    include_in_tax: true,
    source_id: companyId,
    forecast_expense_per_period: projectedForecastExpensePerPeriod,
    forecast_expense_notes: "E2E seeded forecast overhead",
  });
  if (pErr) throw new Error(`projected stream insert failed: ${pErr.message}`);

  // 5) YTD catch-up (small W-2 sliver to exercise overlap safeguard path)
  const ytdCatchupGross = 5_000;
  const { error: yErr } = await client.from("ytd_catchup_entries").insert({
    user_id: userId,
    organization_id: organizationId,
    tax_year: year,
    source_type: "w2",
    company_name: "E2E Hospital",
    period_start: `${year}-01-01`,
    period_end: `${year}-02-28`,
    gross_income: ytdCatchupGross,
    federal_withholding: 600,
    state_withholding: 0,
    ss_withholding: 310,
    medicare_withholding: 73,
    notes: "E2E seeded YTD catch-up",
  });
  if (yErr) throw new Error(`ytd_catchup insert failed: ${yErr.message}`);

  return {
    companyId,
    businessGrossIncome,
    businessExpensesTotal,
    businessNetProfit: businessGrossIncome - businessExpensesTotal,
    ytdCatchupGross,
    projectedForecastExpensePerPeriod,
  };
}

/** One-shot: signup + onboard + seed. Returns everything the spec needs. */
export async function provisionDisposableUser(label = "user"): Promise<DisposableUser> {
  const { client, email, password, userId, organizationId } = await createDisposableUser(label);
  await completeOnboarding(client, organizationId);
  const fixtures = await seedFixtures(client, userId, organizationId);
  return { email, password, userId, organizationId, client, fixtures };
}
