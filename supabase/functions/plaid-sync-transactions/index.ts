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

    // Get user's plaid accounts for transfer detection
    const { data: userAccounts } = await adminClient
      .from("plaid_accounts")
      .select("plaid_account_id, account_type, account_subtype")
      .eq("user_id", user.id)
      .eq("is_active", true);
    const accounts: PlaidAccount[] = userAccounts || [];
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
    // Collect newly added transactions for cross-account transfer matching
    const newlyAdded: Array<{
      id: string;
      plaid_account_id: string;
      amount: number;
      date: string;
      name: string;
      raw_amount: number; // original Plaid sign
    }> = [];

    for (const item of plaidItems) {
      let hasMore = true;
      let cursor = item.cursor || undefined;

      while (hasMore) {
        const syncBody: Record<string, unknown> = {
          client_id: PLAID_CLIENT_ID,
          secret: PLAID_SECRET,
          access_token: item.access_token,
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
          // Store raw plaid transaction
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

          // Classify transaction type
          // Plaid: positive amount = money leaving (expense), negative = money coming in (income)
          const isExpense = txn.amount > 0;
          const txnName = txn.name || txn.merchant_name || "";
          const isLiability = isLiabilityAccount(accounts, txn.account_id);
          const nameHint = looksLikeTransfer(txnName);

          // Plaid personal_finance_category can hint at transfers
          const plaidCategory = (txn.personal_finance_category?.primary || "").toUpperCase();
          const plaidIsTransfer = plaidCategory === "TRANSFER_IN" || plaidCategory === "TRANSFER_OUT"
            || plaidCategory === "LOAN_PAYMENTS" || plaidCategory === "BANK_FEES";

          let txType = isExpense ? "expense" : "income";
          let transferSubtype: string | null = null;

          // Rule 1: Positive inflow to a liability/credit account → likely CC payment
          if (!isExpense && isLiability) {
            txType = "transfer";
            transferSubtype = "credit_card_payment";
          }
          // Rule 2: Plaid categorizes it as a transfer
          else if (plaidIsTransfer && plaidCategory !== "BANK_FEES") {
            txType = "transfer";
            transferSubtype = "account_transfer";
          }
          // Rule 3: Name strongly suggests a transfer
          else if (nameHint) {
            // If it's a credit to a liability account it's definitely a payment
            // Otherwise mark as possible transfer with needs_review
            txType = "transfer";
            transferSubtype = isLiability ? "credit_card_payment" : "account_transfer";
          }

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
            entity: "Unassigned",
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
              amount: txn.amount, // keep original sign
              date: txn.date,
              name: txnName,
              raw_amount: txn.amount,
            });
          }
        }

        // Process MODIFIED transactions (update existing)
        const modified = syncData.modified || [];
        for (const txn of modified) {
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
    // Look for pairs: debit from one owned account + credit to another owned account
    // with same amount and dates within 3 days
    if (newlyAdded.length > 1) {
      const debits = newlyAdded.filter((t) => t.raw_amount > 0); // money out
      const credits = newlyAdded.filter((t) => t.raw_amount < 0); // money in

      for (const deb of debits) {
        for (const cred of credits) {
          if (deb.plaid_account_id === cred.plaid_account_id) continue;
          if (!ownedAccountIds.has(deb.plaid_account_id) || !ownedAccountIds.has(cred.plaid_account_id)) continue;

          const amountMatch = Math.abs(Math.abs(deb.amount) - Math.abs(cred.amount)) < 0.02;
          const daysDiff = Math.abs(
            (new Date(deb.date).getTime() - new Date(cred.date).getTime()) / 86400000
          );
          if (amountMatch && daysDiff <= 3) {
            // Mark both as transfers
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
