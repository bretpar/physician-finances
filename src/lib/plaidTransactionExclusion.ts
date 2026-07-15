/**
 * When a canonical Personal Income entry represents a Plaid deposit
 * (via `income_entries.linked_transaction_id`), the underlying canonical
 * `transactions` row must NOT double-count as independent income in
 * Dashboard, Tax Overview, or report totals.
 *
 * We keep the transaction available for bank history and unlink support by:
 *   - status/amount/imported metadata are preserved
 *   - `excluded_from_reports = true`
 *   - `match_status = "linked"`
 *
 * On unlink the reverse is applied (only when no other active canonical
 * income_entries row still represents the same deposit).
 *
 * `income_entries.linked_transaction_id` historically points at either
 * `transactions.id` (planner/manual convert) or `plaid_transactions.id`
 * (legacy personal-account Plaid sync). We resolve either shape.
 */
import { supabase } from "@/integrations/supabase/client";

async function resolveTransactionIds(linkedTransactionId: string): Promise<string[]> {
  const ids = new Set<string>();
  const [{ data: byId }, { data: byPlaidRef }] = await Promise.all([
    supabase.from("transactions").select("id, transaction_type").eq("id", linkedTransactionId),
    supabase.from("transactions").select("id, transaction_type").eq("plaid_transaction_ref", linkedTransactionId),
  ]);
  for (const r of [...(byId || []), ...(byPlaidRef || [])] as any[]) {
    if (r?.id && r?.transaction_type === "income") ids.add(r.id);
  }
  return Array.from(ids);
}

/**
 * Mark the canonical `transactions` row(s) represented by an income entry as
 * excluded from aggregate reports. Safe to call repeatedly. No-op if the
 * income entry has no `linked_transaction_id` or no matching income tx exists.
 */
export async function excludeLinkedTransactionForIncomeEntry(
  linkedTransactionId: string | null | undefined,
): Promise<string[]> {
  if (!linkedTransactionId) return [];
  const txIds = await resolveTransactionIds(linkedTransactionId);
  if (txIds.length === 0) return [];
  await supabase
    .from("transactions")
    .update({ excluded_from_reports: true, match_status: "linked" } as any)
    .in("id", txIds);
  return txIds;
}

/**
 * Restore a previously-excluded canonical `transactions` row to reportable
 * state, but ONLY when no other active (non-merged) canonical income_entries
 * row still references it via `linked_transaction_id`. Prevents duplicate
 * reportable income during partial unlink.
 */
export async function restoreLinkedTransactionForIncomeEntry(
  linkedTransactionId: string | null | undefined,
  excludeIncomeEntryId?: string | string[],
): Promise<string[]> {
  if (!linkedTransactionId) return [];
  const excludeSet = new Set(
    Array.isArray(excludeIncomeEntryId)
      ? excludeIncomeEntryId.filter(Boolean)
      : excludeIncomeEntryId
        ? [excludeIncomeEntryId]
        : [],
  );
  const { data: siblings } = await supabase
    .from("income_entries")
    .select("id, status")
    .eq("linked_transaction_id", linkedTransactionId);
  // Only ACTIVE canonical representations block restoration. A "merged" row
  // is a shadow of some canonical (the canonical is what represents the
  // deposit for aggregation) — but if the caller is dissolving the group
  // that produced that canonical, they must include those canonical IDs in
  // excludeIncomeEntryId. An "unlinked" row is fully detached and never
  // represents.
  const stillRepresented = ((siblings || []) as any[]).some((r) => {
    if (excludeSet.has(r.id)) return false;
    return r.status !== "unlinked" && r.status !== "merged";
  });
  if (stillRepresented) return [];
  const txIds = await resolveTransactionIds(linkedTransactionId);
  if (txIds.length === 0) return [];
  await supabase
    .from("transactions")
    .update({ excluded_from_reports: false, match_status: "unmatched" } as any)
    .in("id", txIds);
  return txIds;
}
