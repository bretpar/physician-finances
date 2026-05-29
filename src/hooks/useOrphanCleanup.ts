/**
 * Orphan cleanup hooks.
 *
 * "Orphans" here = `income_entries` rows whose `linked_transaction_id`
 * points to a transaction that no longer exists in the `transactions`
 * table. They can appear when a transaction is hard-deleted (manually in
 * the DB, or via legacy code paths) without removing the linked
 * income_entries row.
 *
 * The Tax Overview already filters orphans out at read time via
 * `useTaxEstimate.reconciledIncomeEntries`, but DB rows still pile up
 * and confuse users who poke around. These hooks let Settings count and
 * delete them in one click.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  fetchOrphanPlannerEntries,
  deleteOrphanPlannerEntries,
  PLANNER_CLEANUP_INVALIDATION_KEYS,
} from "@/lib/plannerCleanup";

interface OrphanRow {
  id: string;
  company: string;
  income_date: string;
  paycheck_amount: number;
  linked_transaction_id: string | null;
}

async function fetchOrphans(): Promise<OrphanRow[]> {
  const { data: entries, error: ieErr } = await supabase
    .from("income_entries")
    .select("id, company, income_date, paycheck_amount, linked_transaction_id")
    .not("linked_transaction_id", "is", null);
  if (ieErr) throw ieErr;
  const linkedIds = Array.from(
    new Set((entries || []).map((e) => e.linked_transaction_id).filter(Boolean) as string[]),
  );
  if (linkedIds.length === 0) return [];

  const { data: liveTx, error: txErr } = await supabase
    .from("transactions")
    .select("id")
    .in("id", linkedIds);
  if (txErr) throw txErr;
  const liveIds = new Set((liveTx || []).map((t) => t.id));

  return (entries || []).filter((e) => !liveIds.has(e.linked_transaction_id as string)) as OrphanRow[];
}

export function useOrphanIncomeEntries() {
  return useQuery({
    queryKey: ["orphan_income_entries"],
    queryFn: fetchOrphans,
  });
}

export function useDeleteOrphanIncomeEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const orphans = await fetchOrphans();
      if (orphans.length === 0) return 0;
      const { error } = await supabase
        .from("income_entries")
        .delete()
        .in("id", orphans.map((o) => o.id));
      if (error) throw error;
      return orphans.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["orphan_income_entries"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(`Removed ${count} orphaned income entr${count === 1 ? "y" : "ies"}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Orphaned planner-created income entries.
 *
 * These are income_entries with origin_type='planner_converted' whose
 * origin_planner_conversion_id is null (FK was SET NULL when the
 * planner_conversions row was deleted, typically because the stream/bonus
 * was deleted before this fix shipped) or points to a planner_conversions
 * row that no longer exists. Only rows still clearly planner-created
 * ("From planner" notes, no Plaid link) are returned for safe deletion.
 */
export function useOrphanPlannerEntries() {
  return useQuery({
    queryKey: ["orphan_planner_entries"],
    queryFn: fetchOrphanPlannerEntries,
  });
}

export function useDeleteOrphanPlannerEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => deleteOrphanPlannerEntries(ids),
    onSuccess: (count) => {
      for (const key of PLANNER_CLEANUP_INVALIDATION_KEYS) {
        qc.invalidateQueries({ queryKey: key });
      }
      toast.success(
        `Removed ${count} orphaned planner-created income entr${count === 1 ? "y" : "ies"}`,
      );
    },
    onError: (e: any) => toast.error(e.message),
  });
}
