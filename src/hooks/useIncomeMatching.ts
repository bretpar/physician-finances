import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import type { PersonalIncomeEntry } from "@/hooks/usePersonalIncome";

export interface IncomeMatchGroupItem {
  itemId: string;
  entry: PersonalIncomeEntry;
}

/**
 * Returns a Map keyed by linked_group_id of user-created income entry links.
 * Mirrors useMatchGroups() for transactions.
 */
export function useIncomeMatchGroups() {
  return useQuery({
    queryKey: ["income-match-groups"],
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("income_entry_links")
        .select("id, linked_group_id, canonical_entry_id, merged_entry_id")
        .eq("status", "linked")
        .eq("created_by_user", true);
      if (error) throw error;

      const linkRows = (links || []) as any[];
      const ids = Array.from(
        new Set(linkRows.flatMap((l) => [l.canonical_entry_id, l.merged_entry_id]).filter(Boolean)),
      );
      if (ids.length === 0) return new Map<string, IncomeMatchGroupItem[]>();

      const { data: entries, error: eErr } = await supabase
        .from("income_entries")
        .select("*")
        .in("id", ids);
      if (eErr) throw eErr;
      const byId = new Map<string, PersonalIncomeEntry>(
        (entries || []).map((e: any) => [e.id as string, e as PersonalIncomeEntry]),
      );

      const map = new Map<string, IncomeMatchGroupItem[]>();
      for (const link of linkRows) {
        const groupId = link.linked_group_id as string;
        const arr = map.get(groupId) || [];
        const seen = new Set(arr.map((it) => it.entry.id));
        for (const eid of [link.canonical_entry_id, link.merged_entry_id]) {
          if (!eid || seen.has(eid)) continue;
          const entry = byId.get(eid);
          if (!entry) continue;
          arr.push({ itemId: entry.id, entry });
          seen.add(entry.id);
        }
        map.set(groupId, arr);
      }
      return map;
    },
  });
}

function pickCanonicalIncomeEntry(entries: PersonalIncomeEntry[]): PersonalIncomeEntry {
  // Prefer manual over planner-converted, then most-complete tax data, then earliest created.
  const scored = entries.map((e) => {
    let completeness = 0;
    if (Number(e.federal_withholding || 0) > 0) completeness++;
    if (Number(e.state_withholding || 0) > 0) completeness++;
    if (Number(e.retirement_401k || 0) > 0) completeness++;
    if (Number(e.hsa_contribution || 0) > 0) completeness++;
    if (Number((e as any).additional_tax_reserve || 0) > 0) completeness++;
    if (e.notes && String(e.notes).trim()) completeness++;
    if (e.company && String(e.company).trim()) completeness++;
    const originRank = (e as any).origin_type === "planner_converted" ? 0 : 1;
    return { e, completeness, originRank };
  });
  scored.sort((a, b) => {
    if (b.originRank !== a.originRank) return b.originRank - a.originRank;
    if (b.completeness !== a.completeness) return b.completeness - a.completeness;
    return a.e.created_at.localeCompare(b.e.created_at);
  });
  return scored[0].e;
}

export function useCreateIncomeMatchGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryIds }: { entryIds: string[] }) => {
      if (entryIds.length < 2) throw new Error("Select at least 2 entries to link");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();

      const { data: rows, error } = await supabase
        .from("income_entries")
        .select("*")
        .in("id", entryIds);
      if (error) throw error;
      if (!rows || rows.length !== entryIds.length) {
        throw new Error("Some entries no longer exist. Please refresh.");
      }

      // Block if any selected entry is already in an active user-created link.
      const { data: existing } = await supabase
        .from("income_entry_links")
        .select("canonical_entry_id, merged_entry_id")
        .eq("status", "linked")
        .eq("created_by_user", true)
        .or(
          `canonical_entry_id.in.(${entryIds.join(",")}),merged_entry_id.in.(${entryIds.join(",")})`,
        );
      const already = new Set<string>();
      for (const l of (existing || []) as any[]) {
        if (l.canonical_entry_id) already.add(l.canonical_entry_id);
        if (l.merged_entry_id) already.add(l.merged_entry_id);
      }
      if (already.size > 0) {
        throw new Error("One or more entries are already linked. Unlink them first.");
      }

      const canonical = pickCanonicalIncomeEntry(rows as PersonalIncomeEntry[]);
      const mergedIds = (rows as PersonalIncomeEntry[])
        .filter((r) => r.id !== canonical.id)
        .map((r) => r.id);

      const groupId = crypto.randomUUID();
      const linkRows = mergedIds.map((mid) => ({
        user_id: user.id,
        organization_id: orgId,
        linked_group_id: groupId,
        canonical_entry_id: canonical.id,
        merged_entry_id: mid,
        status: "linked",
        created_by_user: true,
      }));
      const { error: iErr } = await supabase.from("income_entry_links").insert(linkRows as any);
      if (iErr) throw iErr;

      // Soft-merge sibling entries so totals count the group once.
      if (mergedIds.length > 0) {
        const { error: uErr } = await supabase
          .from("income_entries")
          .update({ status: "merged" } as any)
          .in("id", mergedIds);
        if (uErr) throw uErr;
      }
      return groupId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["income-match-groups"] });
      toast.success("Income entries linked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not link entries"),
  });
}

export function useUnlinkIncomeMatchGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, groupId }: { itemId: string; groupId: string }) => {
      // Mark the link row(s) referencing this entry as unlinked.
      const { error: uErr } = await supabase
        .from("income_entry_links")
        .update({ status: "unlinked" } as any)
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true)
        .or(`canonical_entry_id.eq.${itemId},merged_entry_id.eq.${itemId}`);
      if (uErr) throw uErr;

      // Restore the unlinked entry back to active.
      await supabase
        .from("income_entries")
        .update({ status: "received" } as any)
        .eq("id", itemId);

      // If fewer than 2 entries remain in the group, dissolve it.
      const { data: remaining } = await supabase
        .from("income_entry_links")
        .select("canonical_entry_id, merged_entry_id")
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true);
      const remainingIds = Array.from(
        new Set(
          (remaining || []).flatMap((l: any) => [l.canonical_entry_id, l.merged_entry_id]).filter(Boolean),
        ),
      );
      if (remainingIds.length < 2) {
        if (remainingIds.length > 0) {
          await supabase
            .from("income_entries")
            .update({ status: "received" } as any)
            .in("id", remainingIds);
        }
        await supabase
          .from("income_entry_links")
          .update({ status: "unlinked" } as any)
          .eq("linked_group_id", groupId)
          .eq("created_by_user", true);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["income-match-groups"] });
      toast.success("Unlinked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not unlink"),
  });
}
