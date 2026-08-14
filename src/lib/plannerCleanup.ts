/**
 * Orphan planner-entry helpers.
 *
 * Income Planner controls the forecast; the ledger owns historical actuals.
 * Planner deletes/skips therefore never remove income_entries or
 * transactions. The helpers below only surface truly orphaned,
 * never-edited planner-created income entries for an explicit,
 * user-confirmed cleanup in the ledger cleanup UI.
 */


import { supabase } from "@/integrations/supabase/client";


/**
 * NOTE: the previous per-stream / per-occurrence / per-bonus ledger cleanup
 * helpers were intentionally removed. Income Planner changes are forecast
 * changes and must never delete income_entries or transactions. Ledger rows
 * are only deleted from the ledger UI, or via the explicit
 * explicit, user-confirmed cleanup from the ledger cleanup UI.
 */


export interface OrphanPlannerEntry {
  id: string;
  company: string;
  income_date: string;
  paycheck_amount: number;
  notes: string | null;
  linked_transaction_id: string | null;
  origin_planner_conversion_id: string | null;
}

/**
 * Find income_entries that look planner-created but whose
 * origin_planner_conversion_id is null (FK was SET NULL on conversion delete)
 * or points to a planner_conversions row that no longer exists. Only returns
 * rows still safe to delete (notes "From planner", not linked to a Plaid tx).
 */
export async function fetchOrphanPlannerEntries(): Promise<OrphanPlannerEntry[]> {
  const { data } = await supabase
    .from("income_entries")
    .select("id, company, income_date, paycheck_amount, notes, linked_transaction_id, origin_planner_conversion_id, origin_type, created_at, updated_at")
    .eq("origin_type", "planner_converted");
  const rows = (data || []) as any[];
  if (rows.length === 0) return [];

  const referencedConvIds = Array.from(
    new Set(rows.map((r) => r.origin_planner_conversion_id).filter(Boolean) as string[]),
  );
  const liveConvIds = new Set<string>();
  if (referencedConvIds.length > 0) {
    const { data: convs } = await supabase
      .from("planner_conversions")
      .select("id")
      .in("id", referencedConvIds);
    for (const c of (convs || []) as any[]) liveConvIds.add(c.id);
  }

  // Exact notes strings the planner writes at creation. Any deviation
  // (user typed anything, appended a note, etc.) disqualifies the row.
  const PLANNER_NOTES_EXACT = new Set(["From planner", "From planner (bonus)"]);

  return rows
    .filter((r) => !r.origin_planner_conversion_id || !liveConvIds.has(r.origin_planner_conversion_id))
    .filter((r) => {
      if (r.linked_transaction_id) return false;
      if (r.origin_type !== "planner_converted") return false;
      const notes = (r.notes || "").trim();
      if (!PLANNER_NOTES_EXACT.has(notes)) return false;
      // Not user-edited: updated_at must be within 2s of created_at.
      const created = r.created_at ? new Date(r.created_at).getTime() : 0;
      const updated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      if (created && updated && Math.abs(updated - created) > 2000) return false;
      return true;
    })
    .map((r) => ({
      id: r.id,
      company: r.company,
      income_date: r.income_date,
      paycheck_amount: Number(r.paycheck_amount) || 0,
      notes: r.notes,
      linked_transaction_id: r.linked_transaction_id,
      origin_planner_conversion_id: r.origin_planner_conversion_id,
    }));
}

export async function deleteOrphanPlannerEntries(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { error } = await supabase.from("income_entries").delete().in("id", ids);
  if (error) throw error;
  return ids.length;
}

/** Centralized list of react-query keys that need refresh after planner cleanup. */
export const PLANNER_CLEANUP_INVALIDATION_KEYS: string[][] = [
  ["planner_conversions"],
  ["projected_income_streams"],
  ["projected_income_overrides"],
  ["projected_bonus_events"],
  ["income_entries"],
  ["personal_income_entries"],
  ["transactions"],
  ["tax_estimate"],
  ["dashboard_summary"],
  ["orphan_income_entries"],
  ["orphan_planner_entries"],
];
