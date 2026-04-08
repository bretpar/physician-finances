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
  miles: number;
  created_at: string;
  updated_at: string;
}

export const IRS_MILEAGE_RATE = 0.67;

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

export function useAddMileageEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Pick<MileageEntry, "month" | "year" | "company_name" | "miles">) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("mileage_entries").insert({
        user_id: user.id,
        organization_id: orgId,
        month: entry.month,
        year: entry.year,
        company_name: entry.company_name,
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
