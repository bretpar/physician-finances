import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export interface MileageEntry {
  id: string;
  user_id: string;
  month: number;
  year: number;
  company_name: string;
  /** Canonical link to companies.id. Null = unassigned (legacy). */
  company_id: string | null;
  miles: number;
  created_at: string;
  updated_at: string;
}

/**
 * Default / pre-2026 IRS business standard mileage rate (dollars per mile).
 * Kept exported for legacy callers and tests; prefer `getIrsMileageRate(year)`
 * for any new calculation so we respect per-tax-year IRS updates.
 */
export const IRS_MILEAGE_RATE = 0.67;

/**
 * IRS business standard mileage rates by tax year (dollars per mile).
 * Only list years that differ from the legacy default above. Historical
 * years (≤ 2025) intentionally fall through to `IRS_MILEAGE_RATE` so prior
 * deductions are not retroactively changed.
 *
 * 2026: $0.725 / mile (IRS business standard mileage rate).
 */
const IRS_MILEAGE_RATE_BY_YEAR: Record<number, number> = {
  2026: 0.725,
};

/** Returns the IRS business standard mileage rate for the given tax year. */
export function getIrsMileageRate(year: number | null | undefined): number {
  if (typeof year === "number" && IRS_MILEAGE_RATE_BY_YEAR[year] !== undefined) {
    return IRS_MILEAGE_RATE_BY_YEAR[year];
  }
  return IRS_MILEAGE_RATE;
}

/** Sentinel value used in selects to represent "no company / legacy". */
export const UNASSIGNED_COMPANY_VALUE = "__unassigned__";

export function useMileageEntries(month?: number, year?: number) {
  return useQuery({
    queryKey: ["mileage_entries", month, year],
    queryFn: async () => {
      let query = supabase.from("mileage_entries").select("*").order("created_at", { ascending: false });
      if (month !== undefined) query = query.eq("month", month);
      if (year !== undefined) query = query.eq("year", year);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as MileageEntry[];
    },
  });
}

export function useMileageYTD(year: number) {
  return useQuery({
    queryKey: ["mileage_entries", "ytd", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mileage_entries")
        .select("*")
        .eq("year", year)
        .order("month", { ascending: true });
      if (error) throw error;
      return (data || []) as MileageEntry[];
    },
  });
}

/**
 * Returns YTD deductible mileage dollars grouped by company_id.
 * Entries without a company_id are bucketed under the empty string "".
 */
export function getMileageDeductionByCompany(
  entries: MileageEntry[] | undefined | null,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries || []) {
    const key = e.company_id || "";
    const amt = Number(e.miles) * IRS_MILEAGE_RATE;
    map.set(key, (map.get(key) || 0) + amt);
  }
  return map;
}

export function useAddMileageEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Pick<MileageEntry, "month" | "year" | "company_name" | "miles"> & { company_id?: string | null }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("mileage_entries").insert({
        user_id: user.id,
        organization_id: orgId,
        month: entry.month,
        year: entry.year,
        company_name: entry.company_name,
        company_id: entry.company_id ?? null,
        miles: entry.miles,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mileage_entries"] });
      toast.success("Mileage entry added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateMileageEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MileageEntry> & { id: string }) => {
      const { error } = await supabase.from("mileage_entries").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mileage_entries"] });
      toast.success("Entry updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteMileageEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("mileage_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mileage_entries"] });
      toast.success("Entry deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}
