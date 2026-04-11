import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { useMemo } from "react";

export const ACCOUNT_TYPES = [
  { value: "401k", label: "Traditional 401(k)" },
  { value: "403b", label: "403(b)" },
  { value: "457b", label: "457(b)" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "sep_ira", label: "SEP IRA" },
  { value: "simple_ira", label: "SIMPLE IRA" },
  { value: "hsa", label: "HSA (Pre-Tax)" },
] as const;

export const FREQUENCIES = [
  { value: "per_paycheck", label: "Per Paycheck" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

export interface RetirementContribution {
  id: string;
  user_id: string;
  organization_id: string | null;
  account_type: string;
  contribution_amount: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  employer_match: number;
  apply_to_withholding: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useRetirementContributions() {
  return useQuery({
    queryKey: ["retirement_contributions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("retirement_contributions" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RetirementContribution[];
    },
  });
}

export function useAddRetirementContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<RetirementContribution>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("retirement_contributions" as any).insert({
        user_id: user.id,
        organization_id: orgId,
        account_type: entry.account_type || "401k",
        contribution_amount: entry.contribution_amount || 0,
        frequency: entry.frequency || "per_paycheck",
        start_date: entry.start_date || new Date().toISOString().split("T")[0],
        end_date: entry.end_date || null,
        employer_match: entry.employer_match || 0,
        apply_to_withholding: entry.apply_to_withholding ?? true,
        notes: entry.notes || "",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retirement_contributions"] });
      toast.success("Contribution added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateRetirementContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<RetirementContribution> & { id: string }) => {
      const { error } = await supabase
        .from("retirement_contributions" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retirement_contributions"] });
      toast.success("Contribution updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteRetirementContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("retirement_contributions" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["retirement_contributions"] });
      toast.success("Contribution deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

// Calculate annualized total of all active contributions
export function useAnnualizedContributions(contributions: RetirementContribution[] | undefined) {
  return useMemo(() => {
    if (!contributions || contributions.length === 0) {
      return { total: 0, withholding: 0, projectionOnly: 0, perPaycheck: 0 };
    }

    const today = new Date().toISOString().split("T")[0];

    let total = 0;
    let withholding = 0;
    let projectionOnly = 0;
    let perPaycheck = 0;

    for (const c of contributions) {
      // Skip if ended
      if (c.end_date && c.end_date < today) continue;
      // Skip if not started
      if (c.start_date > today) continue;

      const amt = Number(c.contribution_amount);
      let annual = 0;

      switch (c.frequency) {
        case "per_paycheck":
          annual = amt * 26; // assume biweekly
          perPaycheck += amt;
          break;
        case "monthly":
          annual = amt * 12;
          perPaycheck += amt / 2; // approximate per-paycheck
          break;
        case "yearly":
          annual = amt;
          perPaycheck += amt / 26;
          break;
        default:
          annual = amt * 12;
      }

      total += annual;
      if (c.apply_to_withholding) {
        withholding += annual;
      } else {
        projectionOnly += annual;
      }
    }

    return { total, withholding, projectionOnly, perPaycheck };
  }, [contributions]);
}
