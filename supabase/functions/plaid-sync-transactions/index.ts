const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
import { createClient } from "npm:@supabase/supabase-js@2";

// Keywords that suggest a transfer / credit card payment
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
  plaid_account_id: string;
  account_type: string;
  account_subtype: string | null;
}

function isLiabilityAccount(accounts: PlaidAccount[], plaidAccountId: string): boolean {
  const acct = accounts.find((a) => a.plaid_account_id === plaidAccountId);
  if (!acct) return false;
  const t = (acct.account_type || "").toLowerCase();
  const st = (acct.account_subtype || "").toLowerCase();
  return t === "credit" || t === "loan" || st === "credit card";
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

    // Get user's org
    const { data: orgMember } = await adminClient
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const orgId = orgMember?.organization_id;

    // Get user's plaid accounts with routing info
    const { data: userAccounts } = await adminClient
      .from("plaid_accounts")
      .select("plaid_account_id, account_type, account_subtype, default_company_id, account_business_mode, sync_enabled, account_routing")
      .eq("user_id", user.id)
      .eq("is_active", true);

    // Build routing map: plaid_account_id → routing
    const routingMap: Record<string, string> = {};
    for (const a of (userAccounts || []) as any[]) {
      routingMap[a.plaid_account_id] = a.account_routing || "needs_review";
    }

    // Build set of sync-enabled account IDs (only business + personal routing, not ignore/needs_review)
    const syncEnabledIds = new Set(
      (userAccounts || [])
        .filter((a: any) => a.sync_enabled !== false && (a.account_routing === "business" || a.account_routing === "personal"))
        .map((a: any) => a.plaid_account_id)
    );

    const accounts: PlaidAccount[] = (userAccounts || []) as any;

    // Build a map of plaid_account_id → default company name
    const companyIds = (userAccounts || []).filter((a: any) => a.default_company_id).map((a: any) => a.default_company_id);
    let companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await adminClient
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      for (const c of (companies || [])) {
        companyMap[c.id] = c.name;
      }
    }
    // Map plaid_account_id → { companyName, mode }
    const accountBizMap: Record<string, { companyName: string; mode: string }> = {};
    for (const a of (userAccounts || []) as any[]) {
      if (a.account_business_mode === "single_business" && a.default_company_id && companyMap[a.default_company_id]) {
        accountBizMap[a.plaid_account_id] = {
          companyName: companyMap[a.default_company_id],
          mode: "single_business",
        };
      }
    }
    const ownedAccountIds = new Set(accounts.map((a) => a.plaid_account_id));

    // Get plaid items
    let itemsQuery = adminClient
      .from("plaid_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active");
    
    if (targetItemId) {
      itemsQuery = itemsQuery.eq("id", targetItemId);
    }

    const { data: plaidItems, error: itemsError } = await itemsQuery;

    if (itemsError || !plaidItems?.length) {
      return new Response(JSON.stringify({ error: "No connected accounts found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalAdded = 0;
    let totalModified = 0;
    let totalSkipped = 0;
    let totalTombstoned = 0;
    const newlyAdded: Array<{
      id: string;
      plaid_account_id: string;
      amount: number;
      date: string;
      name: string;
      raw_amount: number;
    }> = [];

    // Pre-fetch tombstones so we never resurrect user-deleted Plaid transactions.
    const { data: tombstones } = await adminClient
      .from("plaid_deleted_tombstones")
      .select("plaid_transaction_id")
      .eq("user_id", user.id);
    const tombstonedIds = new Set((tombstones || []).map((t: any) => t.plaid_transaction_id));

    for (const item of plaidItems) {
      let hasMore = true;
      let cursor = item.cursor || undefined;

      // Retrieve access token from Vault if available
      let accessToken = item.access_token;
      if (item.vault_secret_id) {
        const { data: vaultToken, error: vaultErr } = await adminClient.rpc("get_plaid_access_token", {
          _item_id: item.id,
        });
        if (!vaultErr && vaultToken) {
          accessToken = vaultToken;
        } else {
          console.error("Failed to retrieve token from vault for item:", item.id, vaultErr);
        }
      }

      while (hasMore) {
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
          break;
        }

        // Process ADDED transactions
        const added = syncData.added || [];
        for (const txn of added) {
          const routing = routingMap[txn.account_id] || "needs_review";

          // Skip transactions from accounts that are ignored, needs_review, or sync disabled
          if (!syncEnabledIds.has(txn.account_id)) {
            totalSkipped++;
            continue;
          }

          // Honor the user's prior delete: never resurrect a tombstoned tx.
          if (tombstonedIds.has(txn.transaction_id)) {
            totalTombstoned++;
            continue;
          }

          // Store raw plaid transaction (idempotent on plaid_transaction_id)
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
              category_raw: txn.personal_finance_category?.primary || 
                (Array.isArray(txn.category) ? txn.category[0] : null),
              pending: txn.pending || false,
              payment_channel: txn.payment_channel || null,
              raw_json: txn,
            }, { onConflict: "plaid_transaction_id" })
            .select("id")
            .single();

          if (plaidTxError) {
            console.error("Insert plaid_transaction error:", plaidTxError);
            continue;
          }

          // ── Route based on account_routing ──
          if (routing === "personal") {
            // Personal routing → insert into income_entries as personal income
            const isIncome = txn.amount < 0; // Plaid: negative = money in
            const txnName = txn.merchant_name || txn.name || "";
            
            const { error: personalError } = await adminClient.from("income_entries").insert({
              user_id: user.id,
              organization_id: orgId,
              name: txnName,
              company: item.institution_name,
              income_type: "W2",
              source_bucket: "personal",
              tax_category: "ordinary",
              income_date: txn.date,
              gross_amount: Math.abs(txn.amount),
              paycheck_amount: isIncome ? Math.abs(txn.amount) : 0,
              deposited_amount: isIncome ? Math.abs(txn.amount) : 0,
              is_actual: true,
              include_in_tax_estimate: isIncome,
              include_in_cash_flow: true,
              linked_transaction_id: plaidTxRow?.id || null,
              notes: `Imported from ${item.institution_name} (personal account)`,
            });

            if (personalError) {
              console.error("Insert personal income_entry error:", personalError);
            } else {
              totalAdded++;
            }
            continue;
          }

          // ── Business routing → insert into transactions table ──
          const isExpense = txn.amount > 0;
          const txnName = txn.name || txn.merchant_name || "";
          const isLiability = isLiabilityAccount(accounts, txn.account_id);
          const nameHint = looksLikeTransfer(txnName);

          const plaidCategory = (txn.personal_finance_category?.primary || "").toUpperCase();
          const plaidIsTransfer = plaidCategory === "TRANSFER_IN" || plaidCategory === "TRANSFER_OUT"
            || plaidCategory === "LOAN_PAYMENTS" || plaidCategory === "BANK_FEES";

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

          const bizInfo = accountBizMap[txn.account_id];
          const assignedEntity = bizInfo ? bizInfo.companyName : "Unassigned";
          const assignmentSource = bizInfo ? "account_default" : "none";

          const { error: appTxError } = await adminClient.from("transactions").insert({
            user_id: user.id,
            organization_id: orgId,
            transaction_date: txn.date,
            vendor: txn.merchant_name || txn.name || "",
            amount: Math.abs(txn.amount),
            category: txType === "transfer" ? "Transfer" : "Uncategorized",
            account_source: item.institution_name,
            transaction_type: txType,
            transfer_subtype: transferSubtype,
            source_type: "plaid",
            plaid_transaction_ref: plaidTxRow?.id || null,
            match_status: "unmatched",
            entity: assignedEntity,
            assignment_source: assignmentSource,
            notes: "",
            needs_review: true,
            excluded_from_reports: txType === "transfer",
          });

          if (appTxError) {
            console.error("Insert app transaction error:", appTxError);
          } else {
            totalAdded++;
            newlyAdded.push({
              id: plaidTxRow?.id || "",
              plaid_account_id: txn.account_id,
              amount: txn.amount,
              date: txn.date,
              name: txnName,
              raw_amount: txn.amount,
            });
          }
        }

        // Process MODIFIED transactions (update existing)
        const modified = syncData.modified || [];
        for (const txn of modified) {
          if (!syncEnabledIds.has(txn.account_id)) continue;
          // Always update raw plaid_transactions for audit
          await adminClient
            .from("plaid_transactions")
            .update({
              date: txn.date,
              authorized_date: txn.authorized_date || null,
              name: txn.name || "",
              merchant_name: txn.merchant_name || null,
              amount: Math.abs(txn.amount),
              pending: txn.pending || false,
              raw_json: txn,
            })
            .eq("plaid_transaction_id", txn.transaction_id);

          // Only update app transactions row if NOT user-edited
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
                .update({
                  transaction_date: txn.date,
                  vendor: txn.name || "",
                  amount: Math.abs(txn.amount),
                })
                .eq("id", appTx.id);
            }
          }
          totalModified++;
        }

        // Process REMOVED transactions (soft-delete app transactions)
        const removed = syncData.removed || [];
        for (const txn of removed) {
          const { data: plaidTx } = await adminClient
            .from("plaid_transactions")
            .select("id")
            .eq("plaid_transaction_id", txn.transaction_id)
            .single();
          
          if (plaidTx) {
            await adminClient
              .from("transactions")
              .update({ is_deleted: true })
              .eq("plaid_transaction_ref", plaidTx.id);
          }
        }

        cursor = syncData.next_cursor;
        hasMore = syncData.has_more;
      }

      // Save cursor and update last_synced_at
      await adminClient
        .from("plaid_items")
        .update({
          cursor: cursor || item.cursor,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }

    // ── CROSS-ACCOUNT TRANSFER MATCHING ──
    if (newlyAdded.length > 1) {
      const debits = newlyAdded.filter((t) => t.raw_amount > 0);
      const credits = newlyAdded.filter((t) => t.raw_amount < 0);

      for (const deb of debits) {
        for (const cred of credits) {
          if (deb.plaid_account_id === cred.plaid_account_id) continue;
          if (!ownedAccountIds.has(deb.plaid_account_id) || !ownedAccountIds.has(cred.plaid_account_id)) continue;

          const amountMatch = Math.abs(Math.abs(deb.amount) - Math.abs(cred.amount)) < 0.02;
          const daysDiff = Math.abs(
            (new Date(deb.date).getTime() - new Date(cred.date).getTime()) / 86400000
          );
          if (amountMatch && daysDiff <= 3) {
            await adminClient
              .from("transactions")
              .update({
                transaction_type: "transfer",
                transfer_subtype: "account_transfer",
                category: "Transfer",
                excluded_from_reports: true,
              })
              .eq("plaid_transaction_ref", deb.id);
            await adminClient
              .from("transactions")
              .update({
                transaction_type: "transfer",
                transfer_subtype: "account_transfer",
                category: "Transfer",
                excluded_from_reports: true,
              })
              .eq("plaid_transaction_ref", cred.id);
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      transactions_added: totalAdded,
      transactions_modified: totalModified,
      transactions_skipped: totalSkipped,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
