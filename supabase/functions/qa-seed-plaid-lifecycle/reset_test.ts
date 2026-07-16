// QA reset behavior tests for qa-seed-plaid-lifecycle.
//
// Verifies:
//   1. reset nulls planner_conversions.income_entry_id for QA income entries
//      it deletes (does NOT delete the planner_conversions rows themselves,
//      and does NOT delete the underlying projected_income_streams).
//   2. reset is idempotent — running it twice in a row succeeds, and the
//      second run reports zero deletions.
//   3. reset only touches [qa-plaid-lifecycle]-tagged rows for the calling
//      QA user; unrelated planner streams / conversions / income entries
//      belonging to the SAME user are preserved.
//
// Auth: creates a disposable QA user under @paycheckmd.test so the function's
// email allowlist accepts the JWT. The function URL is derived from
// SUPABASE_URL.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  (Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "").split(",")[0] ||
  "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FN_URL = `${SUPABASE_URL}/functions/v1/qa-seed-plaid-lifecycle`;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function makeQaUser() {
  const a = admin();
  const email = `qa-reset-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@paycheckmd.test`;
  const password = "TestPass123!xyz";
  const { data, error } = await a.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  // Wait briefly for handle_new_user trigger to seed profile/org.
  await new Promise((r) => setTimeout(r, 250));
  const { data: signIn, error: signInErr } = await createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) throw signInErr ?? new Error("signIn failed");
  return { user: data.user, accessToken: signIn.session.access_token, email };
}

async function callFn(action: "seed" | "reset", jwt: string): Promise<{ status: number; body: any }> {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ action }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function cleanupUser(userId: string) {
  const a = admin();
  // Best-effort cascade cleanup for all user-owned rows we may have touched.
  await a.from("planner_conversions").delete().eq("user_id", userId);
  await a.from("income_entries").delete().eq("user_id", userId);
  await a.from("projected_income_streams").delete().eq("user_id", userId);
  await a.from("plaid_transactions").delete().eq("user_id", userId);
  await a.from("plaid_accounts").delete().eq("user_id", userId);
  await a.from("plaid_items").delete().eq("user_id", userId);
  await a.auth.admin.deleteUser(userId).catch(() => {});
}

Deno.test({
  name: "qa reset: nulls planner_conversions.income_entry_id, keeps streams+conversions, is idempotent, spares unrelated rows",
  ignore: !SERVICE_KEY || !SUPABASE_URL,
  fn: async () => {
    const { user, accessToken } = await makeQaUser();
    const a = admin();
    try {
      // ---- Seed the QA lifecycle row for this user.
      const seedRes = await callFn("seed", accessToken);
      assertEquals(seedRes.status, 200, `seed failed: ${JSON.stringify(seedRes.body)}`);
      const qaIncomeEntryId: string = seedRes.body.income_entry_id;
      assert(qaIncomeEntryId, "seed should return income_entry_id");

      // Resolve user's org (created by handle_new_user).
      const { data: prof } = await a
        .from("profiles").select("organization_id").eq("user_id", user.id).maybeSingle();
      const orgId = prof?.organization_id ?? null;

      // ---- Create an UNRELATED projected income stream (should survive reset).
      const { data: unrelatedStream, error: usErr } = await a
        .from("projected_income_streams")
        .insert({
          user_id: user.id,
          organization_id: orgId,
          company: "Unrelated Employer (keep me)",
          company_type: "w2",
          pay_frequency: "biweekly",
          start_date: "2026-01-01",
          paycheck_amount: 5000,
          taxes_withheld: 0,
          retirement_401k: 0,
          pre_tax_deductions: 0,
          is_active: true,
          include_in_tax: true,
          federal_withholding: 0,
          state_withholding: 0,
          ss_withholding: 0,
          medicare_withholding: 0,
          healthcare_deduction: 0,
          additional_tax_reserve: 0,
          notes: "",
          hsa_contribution: 0,
        })
        .select("id").single();
      if (usErr) throw usErr;

      // ---- Create an UNRELATED income entry + planner_conversions row that
      //      references it (should survive reset entirely).
      const { data: unrelatedIncome, error: uiErr } = await a
        .from("income_entries")
        .insert({
          user_id: user.id,
          organization_id: orgId,
          name: "Unrelated income (keep me)",
          company: "Unrelated Employer (keep me)",
          income_type: "w2",
          source_bucket: "personal",
          tax_category: "ordinary",
          income_date: "2026-02-01",
          gross_amount: 5000,
          paycheck_amount: 5000,
          deposited_amount: 5000,
          is_actual: true,
          include_in_tax_estimate: true,
          include_in_cash_flow: true,
          status: "received",
          origin_type: "manual",
          notes: "unrelated",
        })
        .select("id").single();
      if (uiErr) throw uiErr;

      const { data: unrelatedConv, error: ucErr } = await a
        .from("planner_conversions")
        .insert({
          user_id: user.id,
          organization_id: orgId,
          stream_id: unrelatedStream.id,
          occurrence_date: "2026-02-01",
          ledger_bucket: "personal",
          income_entry_id: unrelatedIncome.id,
          status: "converted",
        })
        .select("id, income_entry_id").single();
      if (ucErr) throw ucErr;

      // ---- Create a planner_conversions row that DOES reference the QA
      //      income_entry (this is the row whose income_entry_id must be
      //      nulled — not deleted — on reset).
      const { data: qaConv, error: qcErr } = await a
        .from("planner_conversions")
        .insert({
          user_id: user.id,
          organization_id: orgId,
          stream_id: unrelatedStream.id, // any stream is fine; not deleted
          occurrence_date: "2026-03-01",
          ledger_bucket: "personal",
          income_entry_id: qaIncomeEntryId,
          status: "converted",
        })
        .select("id").single();
      if (qcErr) throw qcErr;

      // ---- Run reset.
      const resetRes = await callFn("reset", accessToken);
      assertEquals(resetRes.status, 200, `reset failed: ${JSON.stringify(resetRes.body)}`);
      assertEquals(resetRes.body.action, "reset");
      assert(
        (resetRes.body.deleted?.income_entries ?? 0) >= 1,
        "reset should have deleted the QA income entry",
      );
      assert(
        (resetRes.body.deleted?.planner_conversion_refs_cleared ?? 0) >= 1,
        "reset should have cleared >=1 planner_conversions.income_entry_id",
      );

      // ---- Assert: QA income entry deleted.
      const { data: qaIeAfter } = await a
        .from("income_entries").select("id").eq("id", qaIncomeEntryId).maybeSingle();
      assertEquals(qaIeAfter, null, "QA income entry should be deleted");

      // ---- Assert: QA-referencing planner_conversions row STILL EXISTS,
      //      but its income_entry_id is now NULL.
      const { data: qaConvAfter } = await a
        .from("planner_conversions")
        .select("id, income_entry_id").eq("id", qaConv.id).maybeSingle();
      assert(qaConvAfter, "planner_conversions row referencing QA income must NOT be deleted");
      assertEquals(
        qaConvAfter!.income_entry_id, null,
        "planner_conversions.income_entry_id must be nulled for deleted QA income entry",
      );

      // ---- Assert: unrelated planner_conversions row untouched.
      const { data: unrelatedConvAfter } = await a
        .from("planner_conversions")
        .select("id, income_entry_id").eq("id", unrelatedConv.id).maybeSingle();
      assert(unrelatedConvAfter, "unrelated planner_conversions row must be preserved");
      assertEquals(
        unrelatedConvAfter!.income_entry_id, unrelatedIncome.id,
        "unrelated planner_conversions.income_entry_id must be unchanged",
      );

      // ---- Assert: unrelated stream + unrelated income entry preserved.
      const { data: unrelatedStreamAfter } = await a
        .from("projected_income_streams").select("id").eq("id", unrelatedStream.id).maybeSingle();
      assert(unrelatedStreamAfter, "unrelated projected_income_streams row must be preserved");

      const { data: unrelatedIncomeAfter } = await a
        .from("income_entries").select("id").eq("id", unrelatedIncome.id).maybeSingle();
      assert(unrelatedIncomeAfter, "unrelated income_entries row must be preserved");

      // ---- Assert: QA plaid_items / plaid_accounts / plaid_transactions gone.
      const { data: qaItems } = await a
        .from("plaid_items").select("id").eq("user_id", user.id).eq("item_id", `qa-lifecycle-item-${user.id}`);
      assertEquals(qaItems?.length ?? 0, 0, "QA plaid_items should be deleted");

      // ---- Idempotency: run reset again; must succeed and report zero deletes.
      const resetRes2 = await callFn("reset", accessToken);
      assertEquals(resetRes2.status, 200, `2nd reset failed: ${JSON.stringify(resetRes2.body)}`);
      assertEquals(resetRes2.body.deleted?.income_entries ?? 0, 0, "2nd reset: 0 income_entries");
      assertEquals(resetRes2.body.deleted?.plaid_items ?? 0, 0, "2nd reset: 0 plaid_items");
      assertEquals(resetRes2.body.deleted?.plaid_accounts ?? 0, 0, "2nd reset: 0 plaid_accounts");
      assertEquals(resetRes2.body.deleted?.plaid_transactions ?? 0, 0, "2nd reset: 0 plaid_transactions");
      assertEquals(
        resetRes2.body.deleted?.planner_conversion_refs_cleared ?? 0, 0,
        "2nd reset: 0 planner_conversion_refs_cleared (already nulled)",
      );

      // ---- Unrelated rows STILL preserved after the second reset.
      const { data: unrelatedStreamAfter2 } = await a
        .from("projected_income_streams").select("id").eq("id", unrelatedStream.id).maybeSingle();
      assert(unrelatedStreamAfter2, "unrelated stream preserved after 2nd reset");
      const { data: unrelatedConvAfter2 } = await a
        .from("planner_conversions").select("id, income_entry_id").eq("id", unrelatedConv.id).maybeSingle();
      assert(unrelatedConvAfter2, "unrelated planner_conversions preserved after 2nd reset");
      assertEquals(unrelatedConvAfter2!.income_entry_id, unrelatedIncome.id);
    } finally {
      await cleanupUser(user.id);
    }
  },
});
