const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
import { createClient } from "npm:@supabase/supabase-js@2";

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

    // Optional: sync a specific item
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

          // Create app transaction linked to plaid record
          // Plaid: negative = income, positive = expense
          const isExpense = txn.amount > 0;
          const { error: appTxError } = await adminClient.from("transactions").insert({
            user_id: user.id,
            organization_id: orgId,
            transaction_date: txn.date,
            vendor: txn.merchant_name || txn.name || "",
            amount: Math.abs(txn.amount),
            category: "Uncategorized",
            account_source: item.institution_name,
            transaction_type: isExpense ? "expense" : "income",
            source_type: "plaid",
            plaid_transaction_ref: plaidTxRow?.id || null,
            match_status: "unmatched",
            entity: "Unassigned",
            notes: "",
            needs_review: true,
          });

          if (appTxError) {
            console.error("Insert app transaction error:", appTxError);
          } else {
            totalAdded++;
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
