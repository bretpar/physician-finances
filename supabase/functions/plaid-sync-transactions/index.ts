const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
import { createClient } from "npm:@supabase/supabase-js@2";

const TRANSFER_KEYWORDS = [
  "payment", "credit card payment", "online payment", "autopay",
  "transfer", "ach payment", "card payment", "bill pay",
  "direct debit", "automatic payment", "payoff",
];

function looksLikeTransfer(name: string): boolean {
  const lower = (name || "").toLowerCase();
  return TRANSFER_KEYWORDS.some((kw) => lower.includes(kw));
}

function normalizeStr(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Stable fingerprint for a Plaid transaction independent of Plaid's
 * transaction_id / account_id / item_id. Used to deduplicate when a user
 * disconnects and reconnects the same bank — Plaid issues fresh ids, but the
 * underlying transaction (same date / amount / vendor / account mask) should
 * relink to the existing row instead of inserting a duplicate.
 */
function computeFingerprint(input: {
  userId: string;
  date: string;
  amount: number;
  name: string;
  merchantName?: string | null;
  institutionName?: string | null;
  accountMask?: string | null;
  category?: string | null;
}): string {
  const amt = Number(input.amount || 0).toFixed(2);
  const name = normalizeStr(input.merchantName || input.name);
  const inst = normalizeStr(input.institutionName);
  const mask = normalizeStr(input.accountMask);
  const cat = normalizeStr(input.category);
  return [input.userId, input.date, amt, name, inst, mask, cat].join("|");
}

async function persistRawPlaidTxn(
  adminClient: any,
  user: { id: string },
  orgId: string | null | undefined,
  item: any,
  txn: any,
  accountMaskByPlaidId: Map<string, string | null>,
): Promise<{ row: any | null; isNew: boolean; relinked: boolean; error: any }> {
  const baseRow = {
    user_id: user.id,
    organization_id: orgId,
    plaid_transaction_id: txn.transaction_id,
    plaid_account_id: txn.account_id,
    date: txn.date,
    authorized_date: txn.authorized_date || null,
    name: txn.name || "",
    merchant_name: txn.merchant_name || null,
    amount: Math.abs(txn.amount),
    iso_currency_code: txn.iso_currency_code || "USD",
    unofficial_currency_code: txn.unofficial_currency_code || null,
    category_raw:
      txn.personal_finance_category?.primary ||
      (Array.isArray(txn.category) ? txn.category[0] : null),
    pending: txn.pending || false,
    payment_channel: txn.payment_channel || null,
    raw_json: txn,
  };

  const fingerprint = computeFingerprint({
    userId: user.id,
    date: baseRow.date,
    amount: baseRow.amount,
    name: baseRow.name,
    merchantName: baseRow.merchant_name,
    institutionName: item?.institution_name,
    accountMask: accountMaskByPlaidId.get(txn.account_id) ?? null,
    category: baseRow.category_raw,
  });

  // 1) Match by Plaid's transaction_id (same item, normal sync).
  const { data: byPlaidId } = await adminClient
    .from("plaid_transactions")
    .select("id")
    .eq("plaid_transaction_id", txn.transaction_id)
    .maybeSingle();

  if (byPlaidId) {
    const { data: updated, error } = await adminClient
      .from("plaid_transactions")
      .update({ ...baseRow, dedupe_fingerprint: fingerprint })
      .eq("id", byPlaidId.id)
      .select("*")
      .single();
    return { row: updated, isNew: false, relinked: false, error };
  }

  // 2) Match by stable fingerprint (reconnect / new item, same underlying txn).
  //    Update plaid_transaction_id + plaid_account_id to the new identifiers
  //    but preserve plaid_transactions.id so existing routed app rows
  //    (transactions.plaid_transaction_ref, income_entries.linked_transaction_id)
  //    stay linked and edits are preserved.
  const { data: byFp } = await adminClient
    .from("plaid_transactions")
    .select("id")
    .eq("user_id", user.id)
    .eq("dedupe_fingerprint", fingerprint)
    .maybeSingle();

  if (byFp) {
    const { data: relinked, error } = await adminClient
      .from("plaid_transactions")
      .update({ ...baseRow, dedupe_fingerprint: fingerprint })
      .eq("id", byFp.id)
      .select("*")
      .single();
    return { row: relinked, isNew: false, relinked: true, error };
  }

  // 3) New transaction.
  const { data: inserted, error } = await adminClient
    .from("plaid_transactions")
    .insert({ ...baseRow, dedupe_fingerprint: fingerprint })
    .select("*")
    .single();
  return { row: inserted, isNew: true, relinked: false, error };
}


interface PlaidAccount {
  id?: string;
  plaid_account_id: string;
  account_name?: string;
  account_type: string;
  account_subtype: string | null;
  default_company_id?: string | null;
  account_business_mode?: string | null;
  sync_enabled?: boolean | null;
  account_routing?: string | null;
}

type AccountStat = {
  account_name: string;
  plaid_account_id: string;
  routing: string;
  sync_enabled: boolean;
  added: number;
  skipped: number;
  needs_review: number;
  routed: number;
};

type RouteContext = {
  adminClient: any;
  user: { id: string };
  orgId: string | null | undefined;
  item: any;
  accounts: PlaidAccount[];
  accountBizMap: Record<string, { companyName: string; companyId: string | null; mode: string }>;
  newlyAdded: Array<{ id: string; plaid_account_id: string; amount: number; date: string; name: string; raw_amount: number }>;
  lastRouteError?: string | null;
};

type RouteResult = "routed" | "duplicate" | "needs_review" | "skipped" | "error";

function isLiabilityAccount(accounts: PlaidAccount[], plaidAccountId: string): boolean {
  const acct = accounts.find((a) => a.plaid_account_id === plaidAccountId);
  if (!acct) return false;
  const t = (acct.account_type || "").toLowerCase();
  const st = (acct.account_subtype || "").toLowerCase();
  return t === "credit" || t === "loan" || st === "credit card";
}

function statFor(stats: Record<string, AccountStat>, account: PlaidAccount | undefined, plaidAccountId: string): AccountStat {
  if (!stats[plaidAccountId]) {
    stats[plaidAccountId] = {
      account_name: account?.account_name || plaidAccountId,
      plaid_account_id: plaidAccountId,
      routing: account?.account_routing || "needs_review",
      sync_enabled: account?.sync_enabled !== false,
      added: 0,
      skipped: 0,
      needs_review: 0,
      routed: 0,
    };
  }
  return stats[plaidAccountId];
}

async function hasExistingRoute(adminClient: any, rawPlaidId: string) {
  const { data: appTx } = await adminClient
    .from("transactions")
    .select("id")
    .eq("plaid_transaction_ref", rawPlaidId)
    .maybeSingle();
  if (appTx) return true;

  const { data: incomeEntry } = await adminClient
    .from("income_entries")
    .select("id")
    .eq("linked_transaction_id", rawPlaidId)
    .maybeSingle();
  return !!incomeEntry;
}

// income_entries.income_type CHECK constraint allowed values (must match DB).
const ALLOWED_INCOME_TYPES = new Set([
  "w2", "1099", "k1", "other", "1099_schedule_c", "k1_partnership",
  "scorp_w2", "scorp_distribution", "w2_user", "w2_partner",
  "short_term_gain", "long_term_gain", "dividend", "interest",
  "rental", "other_income", "loss",
]);

/**
 * Classify a raw plaid transaction's "shape" before routing.
 * Returns one of:
 *   "transfer"      - movement between accounts / cc payment / loan payment
 *   "expense"       - positive amount (money out)
 *   "income"        - negative amount (money in) that is NOT transfer-like
 *   "ambiguous"     - cannot safely classify (e.g. zero, weird category)
 */
function classifyPlaidShape(
  raw: any,
  plaidTxRow: any,
  amount: number,
  isLiability: boolean,
): "transfer" | "expense" | "income" | "ambiguous" {
  const txnName =
    raw.merchant_name || raw.name || plaidTxRow.merchant_name || plaidTxRow.name || "";
  const nameHint = looksLikeTransfer(txnName);
  const plaidCategory = (
    raw.personal_finance_category?.primary || plaidTxRow.category_raw || ""
  ).toUpperCase();
  const plaidIsTransfer =
    plaidCategory === "TRANSFER_IN" ||
    plaidCategory === "TRANSFER_OUT" ||
    plaidCategory === "LOAN_PAYMENTS";

  if (plaidIsTransfer || nameHint) return "transfer";
  // Inflow to a liability/credit card account is a payment, not income.
  if (amount < 0 && isLiability) return "transfer";
  if (amount > 0) return "expense";
  if (amount < 0) return "income";
  return "ambiguous";
}

async function insertAppTransaction(
  ctx: RouteContext,
  plaidTxRow: any,
  raw: any,
  amount: number,
  txnName: string,
  txType: "expense" | "transfer" | "income",
  transferSubtype: string | null,
): Promise<RouteResult> {
  const bizInfo = ctx.accountBizMap[plaidTxRow.plaid_account_id];
  const { data: existing } = await ctx.adminClient
    .from("transactions")
    .select("id")
    .eq("user_id", ctx.user.id)
    .eq("plaid_transaction_ref", plaidTxRow.id)
    .maybeSingle();
  if (existing) return "duplicate";

  const { error } = await ctx.adminClient.from("transactions").insert({
    user_id: ctx.user.id,
    organization_id: ctx.orgId,
    transaction_date: raw.date || plaidTxRow.date,
    vendor: txnName,
    amount: Math.abs(amount),
    category: txType === "transfer" ? "Transfer" : "Uncategorized",
    account_source: ctx.item?.institution_name || "Imported bank account",
    transaction_type: txType,
    transfer_subtype: transferSubtype,
    source_type: "plaid",
    plaid_transaction_ref: plaidTxRow.id,
    match_status: "unmatched",
    entity: bizInfo?.companyName || "Unassigned",
    source_id: bizInfo?.companyId || null,
    assignment_source: bizInfo ? "account_default" : "none",
    notes: "",
    needs_review: true,
    excluded_from_reports: txType === "transfer",
  });

  if (error) {
    console.error("Insert app transaction error:", { plaid_transaction_id: plaidTxRow.plaid_transaction_id, error });
    ctx.lastRouteError = `Routing transaction failed: ${error.message || error.code || "unknown DB error"}`;
    return "error";
  }

  ctx.newlyAdded.push({
    id: plaidTxRow.id,
    plaid_account_id: plaidTxRow.plaid_account_id,
    amount,
    date: raw.date || plaidTxRow.date,
    name: txnName,
    raw_amount: amount,
  });
  return "routed";
}

async function routeRawPlaidTransaction(ctx: RouteContext, plaidTxRow: any, routing: string): Promise<RouteResult> {
  if (routing === "needs_review") return "needs_review";
  if (routing !== "business" && routing !== "personal") return "skipped";
  if (await hasExistingRoute(ctx.adminClient, plaidTxRow.id)) return "duplicate";

  const raw = plaidTxRow.raw_json || {};
  const amount = Number(raw.amount ?? plaidTxRow.amount ?? 0);
  const txnName = raw.merchant_name || raw.name || plaidTxRow.merchant_name || plaidTxRow.name || "";
  const isLiability = isLiabilityAccount(ctx.accounts, plaidTxRow.plaid_account_id);
  const shape = classifyPlaidShape(raw, plaidTxRow, amount, isLiability);

  if (routing === "personal") {
    // Only true inflows that aren't transfers get inserted as income_entries.
    // Transfers, credit-card payments, and expenses go into the transactions
    // ledger (excluded from reports for transfers) so the DB CHECK constraint
    // on income_entries.income_type is never violated.
    if (shape === "transfer") {
      const subtype = isLiability ? "credit_card_payment" : "account_transfer";
      return insertAppTransaction(ctx, plaidTxRow, raw, amount, txnName, "transfer", subtype);
    }
    if (shape === "expense") {
      return insertAppTransaction(ctx, plaidTxRow, raw, amount, txnName, "expense", null);
    }
    if (shape === "ambiguous") {
      ctx.lastRouteError = "Could not classify income type safely — left for review";
      return "needs_review";
    }

    // shape === "income": personal paycheck-like inflow.
    const incomeType = "w2";
    if (!ALLOWED_INCOME_TYPES.has(incomeType)) {
      ctx.lastRouteError = `Unsupported income_type "${incomeType}"`;
      return "needs_review";
    }
    const { error } = await ctx.adminClient.from("income_entries").insert({
      user_id: ctx.user.id,
      organization_id: ctx.orgId,
      name: txnName,
      company: ctx.item?.institution_name || plaidTxRow.account_source || "Imported bank account",
      income_type: incomeType,
      source_bucket: "personal",
      tax_category: "ordinary",
      income_date: raw.date || plaidTxRow.date,
      gross_amount: Math.abs(amount),
      paycheck_amount: Math.abs(amount),
      deposited_amount: Math.abs(amount),
      is_actual: true,
      include_in_tax_estimate: true,
      include_in_cash_flow: true,
      linked_transaction_id: plaidTxRow.id,
      notes: `Imported from ${ctx.item?.institution_name || "bank account"} (personal account)`,
    });
    if (error) {
      console.error("Route personal income_entry error:", { plaid_transaction_id: plaidTxRow.plaid_transaction_id, error });
      ctx.lastRouteError = `Routing personal income failed: ${error.message || error.code || "unknown DB error"}`;
      // Do not abort the whole sync — leave this txn for manual review.
      return "needs_review";
    }
    return "routed";
  }

  // routing === "business"
  let txType: "expense" | "transfer" | "income" = amount > 0 ? "expense" : "income";
  let transferSubtype: string | null = null;
  if (shape === "transfer") {
    txType = "transfer";
    transferSubtype = isLiability ? "credit_card_payment" : "account_transfer";
  }
  return insertAppTransaction(ctx, plaidTxRow, raw, amount, txnName, txType, transferSubtype);
}

async function runCronFanOut(req: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET")!;
  const admin = createClient(url, serviceKey);

  const { data: items, error } = await admin
    .from("plaid_items")
    .select("user_id")
    .eq("status", "active");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userIds = Array.from(new Set((items || []).map((r: any) => r.user_id))).filter(Boolean);

  const endpoint = `${url}/functions/v1/plaid-sync-transactions`;
  const results: Array<{ user_id: string; ok: boolean; status: number }> = [];

  // Fire requests in parallel batches to avoid blocking too long.
  const BATCH = 5;
  for (let i = 0; i < userIds.length; i += BATCH) {
    const batch = userIds.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (uid) => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret,
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ user_id: uid }),
        });
        return { user_id: uid, ok: res.ok, status: res.status };
      })
    );
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
      else results.push({ user_id: "unknown", ok: false, status: 0 });
    }
  }

  console.log("Plaid daily cron fan-out complete", { users: userIds.length, results });
  return new Response(JSON.stringify({ success: true, users: userIds.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Cron-triggered path: refresh all users' connected accounts.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedCron = req.headers.get("x-cron-secret");
    const isCron = !!(cronSecret && providedCron && providedCron === cronSecret);

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }

    let user: { id: string } | null = null;
    if (isCron && !body?.user_id) {
      // Fan out: dispatch one request per user with active plaid_items.
      return await runCronFanOut(req);
    }

    if (isCron && body?.user_id) {
      user = { id: String(body.user_id) };
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
      if (userError || !authUser) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = authUser;
    }

    const targetItemId = body?.item_id;
    const mode = body?.mode === "backfill" ? "backfill" : "sync";
    const targetPlaidAccountId = body?.plaid_account_id;

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const SANDBOX_QA = (Deno.env.get("ENABLE_PLAID_SANDBOX_QA") || "").toLowerCase() === "true";
    const PLAID_ENV = SANDBOX_QA ? "sandbox" : (Deno.env.get("PLAID_ENV") || "sandbox");
    const PLAID_SECRET = PLAID_ENV === "sandbox"
      ? (Deno.env.get("PLAID_SECRET_SANDBOX") || Deno.env.get("PLAID_SECRET"))
      : Deno.env.get("PLAID_SECRET");

    const plaidHost = PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : PLAID_ENV === "development"
        ? "https://development.plaid.com"
        : "https://sandbox.plaid.com";

    console.log("plaid-sync-transactions env", { plaid_env: PLAID_ENV, sandbox_qa: SANDBOX_QA });

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: orgMember } = await adminClient
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const orgId = orgMember?.organization_id;

    const { data: userAccounts } = await adminClient
      .from("plaid_accounts")
      .select("id, plaid_item_id, plaid_account_id, account_name, account_mask, account_type, account_subtype, default_company_id, account_business_mode, sync_enabled, account_routing")
      .eq("user_id", user.id)
      .eq("is_active", true);

    const accounts: PlaidAccount[] = (userAccounts || []) as any;
    const accountMaskByPlaidId = new Map<string, string | null>(
      (userAccounts || []).map((a: any) => [a.plaid_account_id, a.account_mask || null]),
    );
    const accountByPlaidId = new Map(accounts.map((a) => [a.plaid_account_id, a]));
    const ownedAccountIds = new Set(accounts.map((a) => a.plaid_account_id));
    const stats: Record<string, AccountStat> = {};

    const companyIds = accounts.filter((a: any) => a.default_company_id).map((a: any) => a.default_company_id);
    let companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await adminClient
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      for (const c of (companies || [])) companyMap[c.id] = c.name;
    }

    const accountBizMap: Record<string, { companyName: string; companyId: string | null; mode: string }> = {};
    for (const a of accounts as any[]) {
      if (a.account_business_mode === "single_business" && a.default_company_id && companyMap[a.default_company_id]) {
        accountBizMap[a.plaid_account_id] = {
          companyName: companyMap[a.default_company_id],
          companyId: a.default_company_id,
          mode: "single_business",
        };
      }
    }

    // Hidden/terminal statuses we never attempt to sync.
    const HIDDEN_STATUSES = ["disconnected", "deleted", "inactive"];
    let itemsQuery = adminClient
      .from("plaid_items")
      .select("*")
      .eq("user_id", user.id)
      .not("status", "in", `(${HIDDEN_STATUSES.map((s) => `"${s}"`).join(",")})`);
    if (targetItemId) {
      // Per-item Sync Now: allow attempt even if status is needs_reauth/error
      // so the UI can surface the latest Plaid error message.
      itemsQuery = itemsQuery.eq("id", targetItemId);
    }

    const { data: plaidItems, error: itemsError } = await itemsQuery;
    if (itemsError || !plaidItems?.length) {
      return new Response(JSON.stringify({ error: "No connected accounts found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Per-item results returned to the caller so the UI can surface failures.
    const itemResults: Array<{
      item_id: string;
      institution_name: string | null;
      status: "success" | "skipped" | "error";
      error?: string;
      error_code?: string;
      item_status?: string;
    }> = [];

    // Stuck-sync protection: any item previously marked 'syncing' whose last
    // attempt is older than 15 minutes is reset to error so retries aren't
    // blocked and the UI doesn't spin forever.
    const STUCK_THRESHOLD_MS = 15 * 60 * 1000;
    const stuckCutoffIso = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
    await adminClient
      .from("plaid_items")
      .update({
        sync_status: "error",
        last_sync_error: "Previous sync did not complete. Please retry.",
      })
      .eq("user_id", user.id)
      .eq("sync_status", "syncing")
      .lt("last_sync_attempt_at", stuckCutoffIso);

    // Mark all targeted items as syncing + record attempt timestamp.
    const nowIso = new Date().toISOString();
    const targetedItemIds: string[] = (plaidItems || []).map((i: any) => i.id);
    if (targetedItemIds.length) {
      await adminClient
        .from("plaid_items")
        .update({ sync_status: "syncing", last_sync_attempt_at: nowIso })
        .in("id", targetedItemIds);
    }

    let rawImported = 0;
    let totalModified = 0;
    let totalSkipped = 0;
    let totalTombstoned = 0;
    let totalNeedsReview = 0;
    let totalRouted = 0;
    let totalDuplicates = 0;
    let totalRelinked = 0;
    const newlyAdded: Array<{ id: string; plaid_account_id: string; amount: number; date: string; name: string; raw_amount: number }> = [];

    const { data: tombstones } = await adminClient
      .from("plaid_deleted_tombstones")
      .select("plaid_transaction_id")
      .eq("user_id", user.id);
    const tombstonedIds = new Set((tombstones || []).map((t: any) => t.plaid_transaction_id));

    const routeContextFor = (item: any): RouteContext => ({ adminClient, user, orgId, item, accounts, accountBizMap, newlyAdded });

    // Resolve access tokens for all items up-front so we can refresh balances
    // independently of mode and reuse the token for /transactions/sync below.
    const accessTokens = new Map<string, string>();
    for (const item of plaidItems) {
      let accessToken = item.access_token;
      if (item.vault_secret_id) {
        const { data: vaultToken, error: vaultErr } = await adminClient.rpc("get_plaid_access_token", { _item_id: item.id });
        if (!vaultErr && vaultToken) accessToken = vaultToken;
        else console.error("Failed to retrieve token from vault for item:", item.id, vaultErr);
      }
      if (accessToken) accessTokens.set(item.id, accessToken);
    }

    // Refresh account balances for every item BEFORE transaction sync.
    // Failures here must NOT block transaction sync — surface as warnings.
    let balancesRefreshed = 0;
    const balanceWarnings: Array<{ item_id: string; institution_name?: string; error: string }> = [];
    for (const item of plaidItems) {
      const accessToken = accessTokens.get(item.id);
      if (!accessToken) {
        balanceWarnings.push({ item_id: item.id, institution_name: item.institution_name, error: "missing access token" });
        continue;
      }
      try {
        const balRes = await fetch(`${plaidHost}/accounts/balance/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: accessToken }),
        });
        let balData = await balRes.json();
        if (!balRes.ok) {
          const fbRes = await fetch(`${plaidHost}/accounts/get`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token: accessToken }),
          });
          balData = await fbRes.json();
          if (!fbRes.ok) {
            console.error("Plaid balance refresh failed", { item_id: item.id, error: balData });
            balanceWarnings.push({
              item_id: item.id,
              institution_name: item.institution_name,
              error: balData?.error_message || balData?.error_code || "balance refresh failed",
            });
            continue;
          }
        }

        for (const acct of (balData.accounts || [])) {
          const current = acct?.balances?.current ?? null;
          const available = acct?.balances?.available ?? null;
          const updates: Record<string, unknown> = {
            current_balance: current,
            available_balance: available,
            updated_at: new Date().toISOString(),
          };
          if (acct.name) updates.account_name = acct.name;
          if (acct.mask) updates.account_mask = acct.mask;
          if (acct.type) updates.account_type = acct.type;
          if (acct.subtype !== undefined) updates.account_subtype = acct.subtype;

          const { error: updErr, count } = await adminClient
            .from("plaid_accounts")
            .update(updates, { count: "exact" })
            .eq("user_id", user.id)
            .eq("plaid_item_id", item.id)
            .eq("plaid_account_id", acct.account_id);
          if (updErr) {
            console.error("Plaid balance row update failed", { item_id: item.id, account_id: acct.account_id, error: updErr });
            balanceWarnings.push({
              item_id: item.id,
              institution_name: item.institution_name,
              error: `account ${acct.account_id}: ${updErr.message}`,
            });
          } else if ((count ?? 0) > 0) {
            balancesRefreshed++;
          }
        }
      } catch (e) {
        console.error("Plaid balance refresh exception", { item_id: item.id, error: e });
        balanceWarnings.push({
          item_id: item.id,
          institution_name: item.institution_name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (mode === "backfill") {
      let rawQuery = adminClient
        .from("plaid_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("date", { ascending: true });
      if (targetPlaidAccountId) rawQuery = rawQuery.eq("plaid_account_id", targetPlaidAccountId);

      const { data: rawRows, error: rawError } = await rawQuery;
      if (rawError) throw rawError;

      for (const rawRow of (rawRows || []) as any[]) {
        const account = accountByPlaidId.get(rawRow.plaid_account_id);
        const stat = statFor(stats, account, rawRow.plaid_account_id);
        const routing = account?.account_routing || "needs_review";
        stat.routing = routing;
        stat.sync_enabled = account?.sync_enabled !== false;

        if (!account || account.sync_enabled === false || routing === "ignore") {
          stat.skipped++;
          totalSkipped++;
          continue;
        }
        if (tombstonedIds.has(rawRow.plaid_transaction_id)) {
          totalTombstoned++;
          continue;
        }

        const result = await routeRawPlaidTransaction(routeContextFor({ institution_name: "Imported bank account" }), rawRow, routing);
        if (result === "routed") { stat.routed++; totalRouted++; }
        else if (result === "needs_review") { stat.needs_review++; totalNeedsReview++; }
        else if (result === "duplicate") { totalDuplicates++; }
        else if (result === "skipped") { stat.skipped++; totalSkipped++; }
      }
    } else {
      for (const item of plaidItems) {
       try {

        let hasMore = true;
        let cursor = item.cursor || undefined;
        let cursorToSave = item.cursor || undefined;
        let itemHadPersistError = false;
        let plaidErrorPayload: any = null;
        let persistErrorMessage: string | null = null;
        // Stable per-item context so routing failures bubble back via lastRouteError.
        const itemCtx: RouteContext = { adminClient, user, orgId, item, accounts, accountBizMap, newlyAdded, lastRouteError: null };

        let accessToken = accessTokens.get(item.id) || item.access_token;

        if (!accessToken) {
          await adminClient
            .from("plaid_items")
            .update({
              sync_status: "error",
              last_sync_error: "Missing access token — please reconnect",
            })
            .eq("id", item.id);
          itemResults.push({
            item_id: item.id,
            institution_name: item.institution_name,
            status: "error",
            error: "Missing access token — please reconnect",
            item_status: item.status,
          });
          continue;
        }

        while (hasMore && !itemHadPersistError) {
          const syncBody: Record<string, unknown> = {
            client_id: PLAID_CLIENT_ID,
            secret: PLAID_SECRET,
            access_token: accessToken,
            count: 100,
          };
          if (cursor) syncBody.cursor = cursor;

          const syncRes = await fetch(`${plaidHost}/transactions/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(syncBody),
          });

          const syncData = await syncRes.json();
          if (!syncRes.ok) {
            console.error("Plaid sync error:", { item_id: item.id, syncData });
            plaidErrorPayload = syncData;
            itemHadPersistError = true;
            break;
          }

          for (const txn of (syncData.added || [])) {
            const account = accountByPlaidId.get(txn.account_id);
            const routing = account?.account_routing || "needs_review";
            const stat = statFor(stats, account, txn.account_id);
            stat.routing = routing;
            stat.sync_enabled = account?.sync_enabled !== false;

            if (!account || account.sync_enabled === false || routing === "ignore") {
              stat.skipped++;
              totalSkipped++;
              continue;
            }

            const { row: plaidTxRow, isNew, relinked, error: plaidTxError } =
              await persistRawPlaidTxn(adminClient, user, orgId, item, txn, accountMaskByPlaidId);

            if (plaidTxError || !plaidTxRow) {
              console.error("Persist raw plaid_transaction error:", { account_id: txn.account_id, transaction_id: txn.transaction_id, error: plaidTxError });
              persistErrorMessage = `Persisting Plaid transaction failed: ${plaidTxError?.message || plaidTxError?.code || "unknown DB error"}`;
              itemHadPersistError = true;
              break;
            }

            if (isNew) {
              stat.added++;
              rawImported++;
            } else if (relinked) {
              totalRelinked++;
              continue;
            } else {
              totalModified++;
            }

            if (tombstonedIds.has(txn.transaction_id)) {
              totalTombstoned++;
              continue;
            }

            const result = await routeRawPlaidTransaction(itemCtx, plaidTxRow, routing);
            if (result === "routed") { stat.routed++; totalRouted++; }
            else if (result === "needs_review") { stat.needs_review++; totalNeedsReview++; }
            else if (result === "duplicate") { totalDuplicates++; }
            else if (result === "skipped") { stat.skipped++; totalSkipped++; }
            else if (result === "error") {
              persistErrorMessage = itemCtx.lastRouteError || persistErrorMessage || "Failed to route a Plaid transaction";
              itemHadPersistError = true;
              break;
            }
          }

          if (itemHadPersistError) break;

          for (const txn of (syncData.modified || [])) {
            const account = accountByPlaidId.get(txn.account_id);
            const routing = account?.account_routing || "needs_review";
            const stat = statFor(stats, account, txn.account_id);
            stat.routing = routing;
            stat.sync_enabled = account?.sync_enabled !== false;

            if (!account || account.sync_enabled === false || routing === "ignore") {
              stat.skipped++;
              totalSkipped++;
              continue;
            }

            const { row: plaidRow, error: rawUpdateError } =
              await persistRawPlaidTxn(adminClient, user, orgId, item, txn, accountMaskByPlaidId);

            if (rawUpdateError || !plaidRow) {
              console.error("Persist modified raw plaid_transaction error:", { account_id: txn.account_id, transaction_id: txn.transaction_id, error: rawUpdateError });
              persistErrorMessage = `Updating Plaid transaction failed: ${rawUpdateError?.message || rawUpdateError?.code || "unknown DB error"}`;
              itemHadPersistError = true;
              break;
            }

            const { data: appTx } = await adminClient
              .from("transactions")
              .select("id, user_edited")
              .eq("plaid_transaction_ref", plaidRow.id)
              .maybeSingle();

            if (appTx && !appTx.user_edited) {
              await adminClient
                .from("transactions")
                .update({ transaction_date: txn.date, vendor: txn.name || "", amount: Math.abs(txn.amount) })
                .eq("id", appTx.id);
            }
            totalModified++;
          }

          if (itemHadPersistError) break;

          for (const txn of (syncData.removed || [])) {
            const { data: plaidTx } = await adminClient
              .from("plaid_transactions")
              .select("id")
              .eq("plaid_transaction_id", txn.transaction_id)
              .maybeSingle();

            if (plaidTx) {
              const { data: appRow } = await adminClient
                .from("transactions")
                .select("id, user_edited")
                .eq("plaid_transaction_ref", plaidTx.id)
                .maybeSingle();

              if (appRow?.user_edited) {
                await adminClient
                  .from("transactions")
                  .update({ plaid_transaction_ref: null, match_status: "plaid_removed" })
                  .eq("id", appRow.id);
              } else if (appRow) {
                await adminClient.from("transactions").delete().eq("id", appRow.id);
              }
            }

            await adminClient
              .from("plaid_deleted_tombstones")
              .upsert({ user_id: user.id, organization_id: orgId, plaid_transaction_id: txn.transaction_id, reason: "plaid_removed" }, { onConflict: "user_id,plaid_transaction_id", ignoreDuplicates: true });
            totalTombstoned++;
          }

          cursor = syncData.next_cursor;
          cursorToSave = syncData.next_cursor;
          hasMore = syncData.has_more;
        }

        if (!itemHadPersistError) {
          const successIso = new Date().toISOString();
          // Clear any prior login_required/error/needs_reauth on success.
          const itemStatusUpdate =
            item.status === "active" ? {} : { status: "active" };
          await adminClient
            .from("plaid_items")
            .update({
              cursor: cursorToSave || item.cursor,
              last_synced_at: successIso,
              last_successful_sync_at: successIso,
              last_sync_error: null,
              sync_status: "idle",
              ...itemStatusUpdate,
            })
            .eq("id", item.id);
          itemResults.push({
            item_id: item.id,
            institution_name: item.institution_name,
            status: "success",
            item_status: "active",
          });
        } else {
          // Capture concise Plaid error code/message and map auth failures.
          // If the failure was internal (DB / routing), surface persistErrorMessage
          // instead of a meaningless generic message.
          const errCode: string | undefined = plaidErrorPayload?.error_code;
          const errType: string | undefined = plaidErrorPayload?.error_type;
          const plaidMsg: string | undefined =
            plaidErrorPayload?.error_message || plaidErrorPayload?.display_message;
          let conciseErr: string;
          if (plaidErrorPayload) {
            const base = plaidMsg || errCode || "Plaid sync failed";
            conciseErr = errCode ? `${errCode}: ${base}` : base;
          } else if (persistErrorMessage) {
            conciseErr = persistErrorMessage;
          } else {
            conciseErr = "Sync failed at Plaid /transactions/sync — see edge function logs";
          }
          // Trim to keep DB column tidy.
          conciseErr = conciseErr.slice(0, 500);

          const authErrorCodes = new Set([
            "ITEM_LOGIN_REQUIRED",
            "ITEM_LOCKED",
            "INVALID_ACCESS_TOKEN",
            "INVALID_CREDENTIALS",
            "PENDING_EXPIRATION",
            "PENDING_DISCONNECT",
            "USER_PERMISSION_REVOKED",
            "ACCESS_NOT_GRANTED",
          ]);
          const needsReauth = errCode ? authErrorCodes.has(errCode) : false;

          const itemUpdate: Record<string, unknown> = {
            sync_status: "error",
            last_sync_error: conciseErr,
          };
          if (needsReauth) {
            itemUpdate.status = errCode === "ITEM_LOGIN_REQUIRED" ? "login_required" : "needs_reauth";
          }

          console.error("Plaid cursor not advanced because sync failed", {
            item_id: item.id,
            institution_name: item.institution_name,
            error_code: errCode,
            error_type: errType,
            error_message: plaidMsg,
            persist_error: persistErrorMessage,
          });

          await adminClient.from("plaid_items").update(itemUpdate).eq("id", item.id);

          itemResults.push({
            item_id: item.id,
            institution_name: item.institution_name,
            status: "error",
            error: conciseErr,
            error_code: errCode,
            item_status: (itemUpdate.status as string | undefined) || item.status,
          });
        }
       } catch (itemErr) {
         // Defensive catch: any unexpected exception while processing this
         // item is converted to an error state so the UI never gets stuck on
         // "syncing". The cursor is NOT advanced because the success branch
         // never ran.
         const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
         console.error("Plaid sync threw for item", { item_id: item.id, error: msg });
         await adminClient
           .from("plaid_items")
           .update({ sync_status: "error", last_sync_error: msg.slice(0, 500) })
           .eq("id", item.id);
         itemResults.push({
           item_id: item.id,
           institution_name: item.institution_name,
           status: "error",
           error: msg,
           item_status: item.status,
         });
       }
      }
    }

    // Final safety net: any targeted item still flagged 'syncing' (e.g. we
    // bailed out of the loop early without resolving it) is downgraded to
    // error so the UI never spins forever.
    if (targetedItemIds.length) {
      await adminClient
        .from("plaid_items")
        .update({
          sync_status: "error",
          last_sync_error: "Sync did not complete. Please retry.",
        })
        .in("id", targetedItemIds)
        .eq("sync_status", "syncing");
    }

    if (newlyAdded.length > 1) {
      const debits = newlyAdded.filter((t) => t.raw_amount > 0);
      const credits = newlyAdded.filter((t) => t.raw_amount < 0);
      for (const deb of debits) {
        for (const cred of credits) {
          if (deb.plaid_account_id === cred.plaid_account_id) continue;
          if (!ownedAccountIds.has(deb.plaid_account_id) || !ownedAccountIds.has(cred.plaid_account_id)) continue;
          const amountMatch = Math.abs(Math.abs(deb.amount) - Math.abs(cred.amount)) < 0.02;
          const daysDiff = Math.abs((new Date(deb.date).getTime() - new Date(cred.date).getTime()) / 86400000);
          if (amountMatch && daysDiff <= 3) {
            await adminClient.from("transactions").update({ transaction_type: "transfer", transfer_subtype: "account_transfer", category: "Transfer", excluded_from_reports: true }).eq("plaid_transaction_ref", deb.id);
            await adminClient.from("transactions").update({ transaction_type: "transfer", transfer_subtype: "account_transfer", category: "Transfer", excluded_from_reports: true }).eq("plaid_transaction_ref", cred.id);
          }
        }
      }
    }

    const account_logs = Object.values(stats);
    console.log("Plaid sync account summary", { user_id: user.id, mode, account_logs, balances_refreshed: balancesRefreshed, balance_warnings: balanceWarnings });
    for (const s of account_logs) console.log("Plaid account sync", s);

    return new Response(JSON.stringify({
      success: true,
      mode,
      raw_imported: rawImported,
      transactions_added: totalRouted,
      routed_transactions: totalRouted,
      transactions_modified: totalModified,
      transactions_skipped: totalSkipped,
      skipped_ignored_accounts: totalSkipped,
      needs_review_transactions: totalNeedsReview,
      transactions_tombstoned: totalTombstoned,
      tombstoned_transactions: totalTombstoned,
      duplicate_routes: totalDuplicates,
      relinked_transactions: totalRelinked,
      balances_refreshed: balancesRefreshed,
      balance_warnings: balanceWarnings,
      account_logs,
      item_results: itemResults,
      all_items_ok: itemResults.length === 0 || itemResults.every((r) => r.status === "success"),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Error:", err);
    // Best-effort: clear any items left in 'syncing' state for this user so
    // the UI never spins forever after an unexpected top-level failure.
    try {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const errMsg = err instanceof Error ? err.message : String(err);
      // We don't always have a user here; scope to any rows updated in the
      // last 30 minutes still flagged 'syncing'.
      const recentIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await admin
        .from("plaid_items")
        .update({ sync_status: "error", last_sync_error: `Sync aborted: ${errMsg.slice(0, 300)}` })
        .eq("sync_status", "syncing")
        .gt("last_sync_attempt_at", recentIso);
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
