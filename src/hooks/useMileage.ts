import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { parseLocalDate } from "@/lib/localDate";

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
 * Kept exported for legacy callers and tests; prefer
 * `getIrsMileageRate(year, month)` / `getMileageRateForDate(date)` for any new
 * calculation so we respect per-tax-year AND mid-year IRS rate changes.
 */
export const IRS_MILEAGE_RATE = 0.67;

/**
 * Canonical IRS business standard mileage rate config.
 *
 * Only list years that differ from the legacy default above. Historical
 * years (≤ 2025) intentionally fall through to `IRS_MILEAGE_RATE` so prior
 * deductions are not retroactively changed.
 *
 * 2026 has a mid-year IRS rate change:
 *   - Jan 1 – Jun 30, 2026 → $0.725 / mile
 *   - Jul 1 – Dec 31, 2026 → $0.760 / mile
 *
 * Each period entry is `{ fromMonth, rate }` where `fromMonth` is the 1-based
 * month the rate becomes effective (periods listed in ascending order).
 */
const IRS_MILEAGE_RATE_PERIODS_BY_YEAR: Record<
  number,
  ReadonlyArray<{ fromMonth: number; rate: number }>
> = {
  2026: [
    { fromMonth: 1, rate: 0.725 },
    { fromMonth: 7, rate: 0.76 },
  ],
};

/**
 * Returns the IRS business standard mileage rate for the given tax year and
 * (optional) 1-based month. When the month is omitted for a year with a
 * mid-year change, the first (earliest) period rate is used.
 */
export function getIrsMileageRate(
  year: number | null | undefined,
  month?: number | null,
): number {
  if (typeof year !== "number") return IRS_MILEAGE_RATE;
  const periods = IRS_MILEAGE_RATE_PERIODS_BY_YEAR[year];
  if (!periods || periods.length === 0) return IRS_MILEAGE_RATE;
  const m = typeof month === "number" && month >= 1 && month <= 12 ? month : 1;
  let rate = periods[0].rate;
  for (const p of periods) {
    if (m >= p.fromMonth) rate = p.rate;
  }
  return rate;
}

/**
 * Date-aware convenience wrapper: resolves the rate from an actual
 * mileage/expense date (`YYYY-MM-DD` string or Date). Used by any flow that
 * has a real occurrence date rather than a month/year pair.
 */
export function getMileageRateForDate(input: string | Date | null | undefined): number {
  const d = parseLocalDate(input);
  if (!d) return IRS_MILEAGE_RATE;
  return getIrsMileageRate(d.getFullYear(), d.getMonth() + 1);
}

/** Canonical rate for a stored mileage entry (month + year). */
export function getMileageRateForEntry(
  entry: { month?: number | null; year?: number | null } | null | undefined,
): number {
  return getIrsMileageRate(entry?.year, entry?.month);
}

/** Canonical deductible dollars for a stored mileage entry. */
export function getMileageEntryDeduction(
  entry: { month?: number | null; year?: number | null; miles?: number | null } | null | undefined,
): number {
  return Number(entry?.miles || 0) * getMileageRateForEntry(entry);
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
    const amt = getMileageEntryDeduction(e);
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
