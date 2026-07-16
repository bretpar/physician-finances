// qa-seed-plaid-lifecycle — QA-only seeder for the Plaid personal-income lifecycle.
//
// Creates one faithful imported personal W-2 deposit (plaid_item + plaid_account
// + plaid_transaction + income_entries row) for the AUTHENTICATED QA user so
// automation can exercise: import -> planner match/link -> unlink -> relink
// -> delete, without ever touching real Plaid Link or an OTP.
//
// Auth: caller must supply a normal Supabase user JWT in
//   Authorization: Bearer <jwt>

// The target user_id is ALWAYS derived from the JWT. Body user_id is ignored.
// Only emails matching QA patterns are accepted:
//   - *@paycheckmd.test
//   - brendantparker+*@gmail.com
//
// Actions: { action: "seed" | "reset", date?: "YYYY-MM-DD", source_id?: uuid }
//
// All seeded rows are tagged with the sentinel "[qa-plaid-lifecycle]" in the
// most-appropriate stringy field, and stable per-user identifiers, so reset
// deletes only rows created by this harness for the calling user.
//
// Follows current production sync architecture: personal-account paycheck
// deposits DO NOT create an app `transactions` row — only a plaid_transactions
// row plus an income_entries row whose linked_transaction_id points at
// plaid_transactions.id. See supabase/functions/plaid-sync-transactions.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",

};

const QA_TAG = "[qa-plaid-lifecycle]";
const QA_EMPLOYER = "Plaid Lifecycle QA Hospital";
const QA_INSTITUTION = "QA Plaid Bank";
const QA_AMOUNT = 6485;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAllowedQaEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.endsWith("@paycheckmd.test")) return true;
  if (e.startsWith("brendantparker+") && e.endsWith("@gmail.com")) return true;
  return false;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function qaItemIdFor(userId: string) {
  return `qa-lifecycle-item-${userId}`;
}
function qaAccountIdFor(userId: string) {
  return `qa-lifecycle-acct-${userId}`;
}
function qaPlaidTxIdFor(userId: string) {
  return `qa-lifecycle-txn-${userId}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Not authenticated" }, 401);
  }


  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const user = userData.user;
  if (!isAllowedQaEmail(user.email)) {
    return json({ error: "Refused: caller email is not a QA test account" }, 403);
  }
  const userId = user.id;

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const action: string = String(body?.action || "seed").toLowerCase();
  if (action !== "seed" && action !== "reset") {
    return json({ error: `Unsupported action "${action}" (expected seed|reset)` }, 400);
  }

  // Resolve org.
  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  const orgId: string | null = profile?.organization_id ?? null;

  // ---- Common: locate any existing QA rows for this user (idempotency & reset).
  const qaItemId = qaItemIdFor(userId);
  const qaAccountPlaidId = qaAccountIdFor(userId);
  const qaPlaidTxId = qaPlaidTxIdFor(userId);

  async function findExisting() {
    const { data: item } = await admin
      .from("plaid_items").select("id").eq("user_id", userId).eq("item_id", qaItemId).maybeSingle();
    const { data: account } = await admin
      .from("plaid_accounts").select("id").eq("user_id", userId).eq("plaid_account_id", qaAccountPlaidId).maybeSingle();
    const { data: plaidTx } = await admin
      .from("plaid_transactions").select("id").eq("user_id", userId).eq("plaid_transaction_id", qaPlaidTxId).maybeSingle();
    return { item, account, plaidTx };
  }

  async function deleteQaForUser() {
    const { item, account, plaidTx } = await findExisting();
    // Delete in relationship-safe order:
    //  1. income_entries linked to the QA plaid_transaction (or tagged)
    //  2. any app transactions that referenced the QA plaid_transaction
    //  3. plaid_transactions
    //  4. plaid_accounts
    //  5. plaid_items
    const counts: Record<string, number> = {
      income_entries: 0, transactions: 0, plaid_transactions: 0,
      plaid_accounts: 0, plaid_items: 0, planner_conversion_refs_cleared: 0,
    };

    // Capture income_entry IDs slated for deletion so we can null out any
    // planner_conversions.income_entry_id references before the delete.
    // Preserves the planner_conversions row (and the underlying planner
    // stream / occurrence) so the planner side is not silently wiped.
    const idsToDelete = new Set<string>();
    if (plaidTx?.id) {
      const { data: linkedRows } = await admin
        .from("income_entries")
        .select("id")
        .eq("user_id", userId)
        .eq("linked_transaction_id", plaidTx.id);
      for (const r of (linkedRows || []) as any[]) idsToDelete.add(r.id);
    }
    const { data: taggedRows } = await admin
      .from("income_entries")
      .select("id")
      .eq("user_id", userId)
      .like("notes", `%${QA_TAG}%`);
    for (const r of (taggedRows || []) as any[]) idsToDelete.add(r.id);

    if (idsToDelete.size > 0) {
      const ids = Array.from(idsToDelete);
      const { data: cleared } = await admin
        .from("planner_conversions")
        .update({ income_entry_id: null })
        .eq("user_id", userId)
        .in("income_entry_id", ids)
        .select("id");
      counts.planner_conversion_refs_cleared = cleared?.length || 0;

      const { data: ieDel } = await admin
        .from("income_entries")
        .delete()
        .eq("user_id", userId)
        .in("id", ids)
        .select("id");
      counts.income_entries += ieDel?.length || 0;
    }

    if (plaidTx?.id) {
      const { data: tx } = await admin
        .from("transactions")
        .delete()
        .eq("user_id", userId)
        .eq("plaid_transaction_ref", plaidTx.id)
        .select("id");
      counts.transactions += tx?.length || 0;
    }

    if (plaidTx?.id) {
      const { data: pt } = await admin
        .from("plaid_transactions").delete().eq("id", plaidTx.id).select("id");
      counts.plaid_transactions += pt?.length || 0;
    }
    if (account?.id) {
      const { data: pa } = await admin
        .from("plaid_accounts").delete().eq("id", account.id).select("id");
      counts.plaid_accounts += pa?.length || 0;
    }
    if (item?.id) {
      const { data: pi } = await admin
        .from("plaid_items").delete().eq("id", item.id).select("id");
      counts.plaid_items += pi?.length || 0;
    }
    return counts;
  }

  if (action === "reset") {
    const counts = await deleteQaForUser();
    return json({
      ok: true, action: "reset", user_id: userId, deleted: counts,
      note: "Only [qa-plaid-lifecycle] records for the authenticated user were removed.",
    });
  }

  // ------------------------ SEED ------------------------
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : todayIso();
  const sourceId: string | null = typeof body?.source_id === "string" ? body.source_id : null;

  // Idempotent: wipe prior QA seed for this user first, then create fresh.
  await deleteQaForUser();

  // 1. plaid_items
  const { data: itemRow, error: itemErr } = await admin
    .from("plaid_items")
    .insert({
      user_id: userId,
      organization_id: orgId,
      item_id: qaItemId,
      institution_id: "ins_qa_lifecycle",
      institution_name: `${QA_INSTITUTION} ${QA_TAG}`,
      status: "active",
      sync_status: "idle",
      vault_secret_id: null,
    })
    .select("*").single();
  if (itemErr) return json({ error: `plaid_items insert failed: ${itemErr.message}` }, 500);

  // 2. plaid_accounts
  const { data: acctRow, error: acctErr } = await admin
    .from("plaid_accounts")
    .insert({
      user_id: userId,
      organization_id: orgId,
      plaid_item_id: itemRow.id,
      plaid_account_id: qaAccountPlaidId,
      account_name: `${QA_INSTITUTION} Checking ${QA_TAG}`,
      account_mask: "0001",
      account_type: "depository",
      account_subtype: "checking",
      is_active: true,
      sync_enabled: true,
      account_routing: "personal",
      account_business_mode: "personal",
    })
    .select("*").single();
  if (acctErr) return json({ error: `plaid_accounts insert failed: ${acctErr.message}` }, 500);

  // 3. plaid_transactions (raw). Amount is stored positive per current sync.
  const raw = {
    qa_tag: QA_TAG,
    transaction_id: qaPlaidTxId,
    account_id: qaAccountPlaidId,
    date,
    name: QA_EMPLOYER,
    merchant_name: QA_EMPLOYER,
    amount: -QA_AMOUNT, // negative = inflow, per Plaid convention
    iso_currency_code: "USD",
    personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
    category: ["Transfer", "Payroll"],
    payment_channel: "other",
    pending: false,
  };
  const { data: ptxRow, error: ptxErr } = await admin
    .from("plaid_transactions")
    .insert({
      user_id: userId,
      organization_id: orgId,
      plaid_account_id: qaAccountPlaidId,
      plaid_transaction_id: qaPlaidTxId,
      date,
      name: QA_EMPLOYER,
      merchant_name: QA_EMPLOYER,
      amount: QA_AMOUNT,
      iso_currency_code: "USD",
      category_raw: "INCOME",
      payment_channel: "other",
      pending: false,
      raw_json: raw,
      dedupe_fingerprint: `qa|${userId}|${date}|${QA_AMOUNT.toFixed(2)}|${QA_EMPLOYER.toLowerCase()}`,
    })
    .select("*").single();
  if (ptxErr) return json({ error: `plaid_transactions insert failed: ${ptxErr.message}` }, 500);

  // 4. NOTE: Current production sync does NOT create an app `transactions`
  //    row for personal-account paycheck deposits — only business/transfer/
  //    expense routes do. We match that architecture and skip it.
  //    plaidTransactionExclusion.ts resolves via linked_transaction_id ->
  //    transactions (either by id or plaid_transaction_ref); with no row
  //    present it simply no-ops, which is the correct behavior.

  // 5. income_entries — the imported personal W-2 deposit.
  const { data: ieRow, error: ieErr } = await admin
    .from("income_entries")
    .insert({
      user_id: userId,
      organization_id: orgId,
      name: QA_EMPLOYER,
      company: QA_EMPLOYER,
      source_id: sourceId,
      income_type: "w2",
      source_bucket: "personal",
      tax_category: "ordinary",
      income_date: date,
      gross_amount: QA_AMOUNT,
      paycheck_amount: QA_AMOUNT,
      deposited_amount: QA_AMOUNT,
      federal_withholding: 0,
      state_withholding: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
      taxes_withheld: 0,
      retirement_401k: 0,
      healthcare_deduction: 0,
      hsa_contribution: 0,
      pre_tax_deductions: 0,
      is_actual: true,
      include_in_tax_estimate: true,
      include_in_cash_flow: true,
      status: "received",
      linked_transaction_id: ptxRow.id,
      origin_type: "plaid_import",
      notes: `${QA_TAG} Imported from ${QA_INSTITUTION} (personal account)`,
    })
    .select("*").single();
  if (ieErr) return json({ error: `income_entries insert failed: ${ieErr.message}` }, 500);

  return json({
    ok: true,
    action: "seed",
    user_id: userId,
    organization_id: orgId,
    plaid_item_id: itemRow.id,
    plaid_account_id: acctRow.id,
    plaid_transaction_id: ptxRow.id,
    app_transaction_id: null, // not created by current personal-account sync
    income_entry_id: ieRow.id,
    linked_transaction_id: ptxRow.id, // income_entries.linked_transaction_id
    employer: QA_EMPLOYER,
    source_id: sourceId,
    date,
    deposit_amount: QA_AMOUNT,
    initial_state: {
      income_entry_status: "received",
      linked_transaction_excluded_from_reports: false,
      match_status_on_linked_transaction: "unmatched",
      note: "No app transactions row exists (matches production personal-account sync).",
    },
  });
});
