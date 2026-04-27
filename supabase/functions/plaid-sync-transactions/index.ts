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

async function routeRawPlaidTransaction(ctx: RouteContext, plaidTxRow: any, routing: string): Promise<RouteResult> {
  if (routing === "needs_review") return "needs_review";
  if (routing !== "business" && routing !== "personal") return "skipped";
  if (await hasExistingRoute(ctx.adminClient, plaidTxRow.id)) return "duplicate";

  const raw = plaidTxRow.raw_json || {};
  const amount = Number(raw.amount ?? plaidTxRow.amount ?? 0);
  const txnName = raw.merchant_name || raw.name || plaidTxRow.merchant_name || plaidTxRow.name || "";

  if (routing === "personal") {
    const isIncome = amount < 0;
    const { error } = await ctx.adminClient.from("income_entries").insert({
      user_id: ctx.user.id,
      organization_id: ctx.orgId,
      name: txnName,
      company: ctx.item?.institution_name || plaidTxRow.account_source || "Imported bank account",
      income_type: "W2",
      source_bucket: "personal",
      tax_category: "ordinary",
      income_date: raw.date || plaidTxRow.date,
      gross_amount: Math.abs(amount),
      paycheck_amount: isIncome ? Math.abs(amount) : 0,
      deposited_amount: isIncome ? Math.abs(amount) : 0,
      is_actual: true,
      include_in_tax_estimate: isIncome,
      include_in_cash_flow: true,
      linked_transaction_id: plaidTxRow.id,
      notes: `Imported from ${ctx.item?.institution_name || "bank account"} (personal account)`,
    });
    if (error) {
      console.error("Route personal income_entry error:", { plaid_transaction_id: plaidTxRow.plaid_transaction_id, error });
      return "error";
    }
    return "routed";
  }

  const isExpense = amount > 0;
  const isLiability = isLiabilityAccount(ctx.accounts, plaidTxRow.plaid_account_id);
  const nameHint = looksLikeTransfer(txnName);
  const plaidCategory = (raw.personal_finance_category?.primary || plaidTxRow.category_raw || "").toUpperCase();
  const plaidIsTransfer = plaidCategory === "TRANSFER_IN" || plaidCategory === "TRANSFER_OUT" || plaidCategory === "LOAN_PAYMENTS" || plaidCategory === "BANK_FEES";

  let txType = isExpense ? "expense" : "income";
  let transferSubtype: string | null = null;
  if (!isExpense && isLiability) {
    txType = "transfer";
    transferSubtype = "credit_card_payment";
  } else if (plaidIsTransfer && plaidCategory !== "BANK_FEES") {
    txType = "transfer";
    transferSubtype = "account_transfer";
  } else if (nameHint) {
    txType = "transfer";
    transferSubtype = isLiability ? "credit_card_payment" : "account_transfer";
  }

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
    console.error("Route business transaction error:", { plaid_transaction_id: plaidTxRow.plaid_transaction_id, error });
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const targetItemId = body?.item_id;
    const mode = body?.mode === "backfill" ? "backfill" : "sync";
    const targetPlaidAccountId = body?.plaid_account_id;

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
    const PLAID_ENV = Deno.env.get("PLAID_ENV") || "sandbox";

    const plaidHost = PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : PLAID_ENV === "development"
        ? "https://development.plaid.com"
        : "https://sandbox.plaid.com";

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
      .select("id, plaid_item_id, plaid_account_id, account_name, account_type, account_subtype, default_company_id, account_business_mode, sync_enabled, account_routing")
      .eq("user_id", user.id)
      .eq("is_active", true);

    const accounts: PlaidAccount[] = (userAccounts || []) as any;
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

    let itemsQuery = adminClient
      .from("plaid_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (targetItemId) itemsQuery = itemsQuery.eq("id", targetItemId);

    const { data: plaidItems, error: itemsError } = await itemsQuery;
    if (itemsError || !plaidItems?.length) {
      return new Response(JSON.stringify({ error: "No connected accounts found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let rawImported = 0;
    let totalModified = 0;
    let totalSkipped = 0;
    let totalTombstoned = 0;
    let totalNeedsReview = 0;
    let totalRouted = 0;
    let totalDuplicates = 0;
    const newlyAdded: Array<{ id: string; plaid_account_id: string; amount: number; date: string; name: string; raw_amount: number }> = [];

    const { data: tombstones } = await adminClient
      .from("plaid_deleted_tombstones")
      .select("plaid_transaction_id")
      .eq("user_id", user.id);
    const tombstonedIds = new Set((tombstones || []).map((t: any) => t.plaid_transaction_id));

    const routeContextFor = (item: any): RouteContext => ({ adminClient, user, orgId, item, accounts, accountBizMap, newlyAdded });

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
        let hasMore = true;
        let cursor = item.cursor || undefined;
        let cursorToSave = item.cursor || undefined;
        let itemHadPersistError = false;

        let accessToken = item.access_token;
        if (item.vault_secret_id) {
          const { data: vaultToken, error: vaultErr } = await adminClient.rpc("get_plaid_access_token", { _item_id: item.id });
          if (!vaultErr && vaultToken) accessToken = vaultToken;
          else console.error("Failed to retrieve token from vault for item:", item.id, vaultErr);
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
            console.error("Plaid sync error:", syncData);
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

            const { data: plaidTxRow, error: plaidTxError } = await adminClient
              .from("plaid_transactions")
              .upsert({
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
                category_raw: txn.personal_finance_category?.primary || (Array.isArray(txn.category) ? txn.category[0] : null),
                pending: txn.pending || false,
                payment_channel: txn.payment_channel || null,
                raw_json: txn,
              }, { onConflict: "plaid_transaction_id" })
              .select("*")
              .single();

            if (plaidTxError || !plaidTxRow) {
              console.error("Persist raw plaid_transaction error:", { account_id: txn.account_id, transaction_id: txn.transaction_id, error: plaidTxError });
              itemHadPersistError = true;
              break;
            }

            stat.added++;
            rawImported++;

            if (tombstonedIds.has(txn.transaction_id)) {
              totalTombstoned++;
              continue;
            }

            const result = await routeRawPlaidTransaction(routeContextFor(item), plaidTxRow, routing);
            if (result === "routed") { stat.routed++; totalRouted++; }
            else if (result === "needs_review") { stat.needs_review++; totalNeedsReview++; }
            else if (result === "duplicate") { totalDuplicates++; }
            else if (result === "skipped") { stat.skipped++; totalSkipped++; }
            else if (result === "error") { itemHadPersistError = true; break; }
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

            const { error: rawUpdateError } = await adminClient
              .from("plaid_transactions")
              .upsert({
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
                category_raw: txn.personal_finance_category?.primary || (Array.isArray(txn.category) ? txn.category[0] : null),
                pending: txn.pending || false,
                payment_channel: txn.payment_channel || null,
                raw_json: txn,
              }, { onConflict: "plaid_transaction_id" });

            if (rawUpdateError) {
              console.error("Persist modified raw plaid_transaction error:", { account_id: txn.account_id, transaction_id: txn.transaction_id, error: rawUpdateError });
              itemHadPersistError = true;
              break;
            }

            const { data: plaidRow } = await adminClient
              .from("plaid_transactions")
              .select("id")
              .eq("plaid_transaction_id", txn.transaction_id)
              .maybeSingle();

            if (plaidRow) {
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
              await adminClient.from("transactions").delete().eq("plaid_transaction_ref", plaidTx.id);
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
          await adminClient
            .from("plaid_items")
            .update({ cursor: cursorToSave || item.cursor, last_synced_at: new Date().toISOString() })
            .eq("id", item.id);
        } else {
          console.error("Plaid cursor not advanced because raw persistence/routing failed", { item_id: item.id, institution_name: item.institution_name });
        }
      }
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
    console.log("Plaid sync account summary", { user_id: user.id, mode, account_logs });
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
      account_logs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
