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
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
    const PLAID_ENV = Deno.env.get("PLAID_ENV") || "sandbox";

    const plaidHost = PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : PLAID_ENV === "development"
        ? "https://development.plaid.com"
        : "https://sandbox.plaid.com";

    // Get all plaid items for the user using service role
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: plaidItems, error: itemsError } = await adminClient
      .from("plaid_items")
      .select("*")
      .eq("user_id", user.id);

    if (itemsError || !plaidItems?.length) {
      return new Response(JSON.stringify({ error: "No connected accounts found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalAdded = 0;

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

        const added = syncData.added || [];
        if (added.length > 0) {
          const rows = added.map((txn: Record<string, unknown>) => ({
            user_id: user.id,
            transaction_date: txn.date as string,
            vendor: (txn.merchant_name || txn.name || "") as string,
            amount: Math.abs(txn.amount as number),
            category: Array.isArray(txn.personal_finance_category)
              ? (txn.personal_finance_category as string[])[0]
              : typeof txn.personal_finance_category === "object" && txn.personal_finance_category !== null
                ? ((txn.personal_finance_category as Record<string, string>).primary || "Uncategorized")
                : "Uncategorized",
            account_source: item.institution_name,
            notes: `Plaid: ${txn.transaction_id}`,
          }));

          const { error: insertError } = await adminClient
            .from("transactions")
            .insert(rows);

          if (insertError) {
            console.error("Insert transactions error:", insertError);
          } else {
            totalAdded += rows.length;
          }
        }

        cursor = syncData.next_cursor;
        hasMore = syncData.has_more;
      }

      // Save cursor for incremental sync
      if (cursor) {
        await adminClient
          .from("plaid_items")
          .update({ cursor })
          .eq("id", item.id);
      }
    }

    return new Response(JSON.stringify({ success: true, transactions_added: totalAdded }), {
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
