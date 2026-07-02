/**
 * Planner conversion cleanup helpers.
 *
 * When a user deletes a projected income stream, skips a single planned
 * paycheck, or deletes a bonus event, any ledger row (income_entries /
 * transactions) that was AUTO/MANUALLY created from that planner occurrence
 * should be removed too — otherwise false "actual" income remains in
 * Personal Income / Business Activity and Tax Overview totals.
 *
 * We only remove rows that are still clearly planner-created:
 *   - origin_type = 'planner_converted'
 *   - notes starts with "From planner"
 *   - income_entries: linked_transaction_id IS NULL (not matched to a real
 *     Plaid/imported transaction)
 *   - transactions: account_source = 'Planner' (not Plaid-imported)
 *
 * Anything that fails these checks is left alone — the user either manually
 * edited it into a confirmed paycheck, or it has been linked/matched to a
 * real bank transaction. Those rows require explicit user action to delete.
 *
 * After ledger cleanup we delete the planner_conversions row(s). For stream
 * deletes the CASCADE would handle that, but we delete explicitly so a
 * caller can run cleanup without immediately dropping the stream.
 */

import { supabase } from "@/integrations/supabase/client";

export interface SafeEraseSummary {
  conversionsScanned: number;
  conversionsDeleted: number;
  incomeEntriesDeleted: number;
  transactionsDeleted: number;
  skippedNotSafe: number;
}

const empty = (): SafeEraseSummary => ({
  conversionsScanned: 0,
  conversionsDeleted: 0,
  incomeEntriesDeleted: 0,
  transactionsDeleted: 0,
  skippedNotSafe: 0,
});

interface ConversionRow {
  id: string;
  stream_id: string | null;
  bonus_event_id: string | null;
  occurrence_date: string;
  ledger_bucket: string | null;
  income_entry_id: string | null;
  transaction_id: string | null;
}

function notesLooksPlannerCreated(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return notes.trim().toLowerCase().startsWith("from planner");
}

/**
 * Attempt to delete the ledger row tied to a single planner_conversions row,
 * but only if it still looks planner-created and unedited. Returns whether
 * the ledger row was removed.
 */
async function tryDeleteLedgerForConversion(
  conv: ConversionRow,
): Promise<{ deletedIncome: boolean; deletedTx: boolean; skipped: boolean }> {
  let deletedIncome = false;
  let deletedTx = false;
  let skipped = false;

  if (conv.income_entry_id) {
    const { data: row } = await supabase
      .from("income_entries")
      .select("id, origin_type, notes, linked_transaction_id")
      .eq("id", conv.income_entry_id)
      .maybeSingle();
    if (row) {
      const safe =
        (row as any).origin_type === "planner_converted" &&
        notesLooksPlannerCreated((row as any).notes) &&
        !(row as any).linked_transaction_id;
      if (safe) {
        const { error } = await supabase
          .from("income_entries")
          .delete()
          .eq("id", conv.income_entry_id);
        if (!error) deletedIncome = true;
      } else {
        skipped = true;
      }
    }
  }

  if (conv.transaction_id) {
    const { data: row } = await supabase
      .from("transactions")
      .select("id, origin_type, notes, account_source")
      .eq("id", conv.transaction_id)
      .maybeSingle();
    if (row) {
      const safe =
        (row as any).origin_type === "planner_converted" &&
        notesLooksPlannerCreated((row as any).notes) &&
        ((row as any).account_source === "Planner" ||
          (row as any).account_source === null);
      if (safe) {
        const { error } = await supabase
          .from("transactions")
          .delete()
          .eq("id", conv.transaction_id);
        if (!error) deletedTx = true;
      } else {
        skipped = true;
      }
    }
  }

  return { deletedIncome, deletedTx, skipped };
}

async function runCleanup(conversions: ConversionRow[]): Promise<SafeEraseSummary> {
  const summary = empty();
  summary.conversionsScanned = conversions.length;
  const idsToDelete: string[] = [];

  for (const conv of conversions) {
    const r = await tryDeleteLedgerForConversion(conv);
    if (r.deletedIncome) summary.incomeEntriesDeleted++;
    if (r.deletedTx) summary.transactionsDeleted++;
    if (r.skipped) summary.skippedNotSafe++;
    // Always remove the planner_conversion record so the planner row no
    // longer renders as "Converted". Even when we couldn't safely remove
    // the ledger row, the conversion link itself is stale once the
    // underlying planner occurrence is gone.
    idsToDelete.push(conv.id);
  }

  if (idsToDelete.length > 0) {
    const { error } = await supabase
      .from("planner_conversions")
      .delete()
      .in("id", idsToDelete);
    if (!error) summary.conversionsDeleted = idsToDelete.length;
  }

  return summary;
}

/** Cleanup planner-created ledger rows for an entire projected income stream. */
export async function cleanupConvertedLedgerForStream(
  streamId: string,
): Promise<SafeEraseSummary> {
  const { data } = await supabase
    .from("planner_conversions")
    .select("id, stream_id, bonus_event_id, occurrence_date, ledger_bucket, income_entry_id, transaction_id")
    .eq("stream_id", streamId);
  return runCleanup((data || []) as ConversionRow[]);
}

/** Cleanup planner-created ledger rows for a single planner occurrence. */
export async function cleanupConvertedLedgerForOccurrence(args: {
  streamId: string;
  occurrenceDate: string;
}): Promise<SafeEraseSummary> {
  const { data } = await supabase
    .from("planner_conversions")
    .select("id, stream_id, bonus_event_id, occurrence_date, ledger_bucket, income_entry_id, transaction_id")
    .eq("stream_id", args.streamId)
    .eq("occurrence_date", args.occurrenceDate);
  return runCleanup((data || []) as ConversionRow[]);
}

/** Cleanup planner-created ledger rows for a bonus event. */
export async function cleanupConvertedLedgerForBonus(
  bonusEventId: string,
): Promise<SafeEraseSummary> {
  const { data } = await supabase
    .from("planner_conversions")
    .select("id, stream_id, bonus_event_id, occurrence_date, ledger_bucket, income_entry_id, transaction_id")
    .eq("bonus_event_id", bonusEventId);
  return runCleanup((data || []) as ConversionRow[]);
}

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
