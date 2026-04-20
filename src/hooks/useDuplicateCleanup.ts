import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Detects duplicate transactions in two ways:
 *  1. Same imported source (user_id + plaid_transaction_ref) — only possible
 *     for legacy data, the unique partial index now blocks new ones.
 *  2. Same manual fingerprint (user_id + date + amount + vendor + type) for
 *     manually entered rows.
 *
 * "Keep newest" is the default cleanup strategy.
 */
export interface DuplicateGroup {
  key: string;
  kind: "plaid" | "manual";
  ids: string[]; // sorted oldest → newest
  keepId: string; // the one we'll keep (newest)
  removeIds: string[];
  sample: {
    vendor: string;
    amount: number;
    transaction_date: string;
    source_type: string;
  };
}

export function useDuplicateScan() {
  return useQuery({
    queryKey: ["duplicate-scan"],
    queryFn: async (): Promise<DuplicateGroup[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("transactions")
        .select("id, user_id, vendor, amount, transaction_date, transaction_type, source_type, plaid_transaction_ref, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data || []) as any[];

      const byPlaid = new Map<string, any[]>();
      const byManual = new Map<string, any[]>();

      for (const r of rows) {
        if (r.plaid_transaction_ref) {
          const k = `${r.user_id}|${r.plaid_transaction_ref}`;
          (byPlaid.get(k) || byPlaid.set(k, []).get(k)!).push(r);
        } else if (r.source_type === "manual" || r.source_type === "merged") {
          const amt = Math.round(Number(r.amount) * 100) / 100;
          const vendor = (r.vendor || "").trim().toLowerCase();
          const k = `${r.user_id}|${r.transaction_date}|${amt}|${vendor}|${r.transaction_type}`;
          (byManual.get(k) || byManual.set(k, []).get(k)!).push(r);
        }
      }

      const groups: DuplicateGroup[] = [];
      const toGroup = (kind: "plaid" | "manual", k: string, items: any[]) => {
        if (items.length < 2) return;
        const sorted = [...items].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const keep = sorted[sorted.length - 1];
        groups.push({
          key: `${kind}:${k}`,
          kind,
          ids: sorted.map((s) => s.id),
          keepId: keep.id,
          removeIds: sorted.slice(0, -1).map((s) => s.id),
          sample: {
            vendor: keep.vendor,
            amount: Number(keep.amount),
            transaction_date: keep.transaction_date,
            source_type: keep.source_type,
          },
        });
      };
      byPlaid.forEach((v, k) => toGroup("plaid", k, v));
      byManual.forEach((v, k) => toGroup("manual", k, v));
      return groups;
    },
  });
}

export function useDeleteDuplicates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { error } = await supabase.from("transactions").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["duplicate-scan"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(`Removed ${count} duplicate transaction${count === 1 ? "" : "s"}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
}
