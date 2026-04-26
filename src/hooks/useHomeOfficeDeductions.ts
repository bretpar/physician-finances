import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toast } from "sonner";

export type HomeOfficeMethod = "simplified_square_footage" | "prior_year_estimate";
export type HomeOfficeStatus = "active" | "deleted";

export interface HomeOfficeDeduction {
  id: string;
  user_id: string;
  organization_id: string | null;
  company_id: string | null;
  deduction_type: "home_office";
  include_in_tax_calculation: boolean;
  method: HomeOfficeMethod;
  square_feet: number | null;
  prior_year_amount: number | null;
  calculated_amount: number;
  allowed_amount: number;
  unused_capped_amount: number;
  tax_year: number;
  status: HomeOfficeStatus;
  created_at: string;
  updated_at: string;
}

export interface HomeOfficeAmounts {
  calculatedAmount: number;
  allowedAmount: number;
  unusedCappedAmount: number;
  cappedSquareFeet: number;
  isSquareFootageCapped: boolean;
}

export function calculateHomeOfficeAmounts(input: {
  method: HomeOfficeMethod;
  squareFeet?: number | null;
  priorYearAmount?: number | null;
  includeInTaxCalculation: boolean;
  availableBusinessProfit: number;
}): HomeOfficeAmounts {
  const squareFeet = Math.max(0, Number(input.squareFeet || 0));
  const cappedSquareFeet = Math.min(squareFeet, 300);
  const calculatedAmount = input.method === "simplified_square_footage"
    ? cappedSquareFeet * 5
    : Math.max(0, Number(input.priorYearAmount || 0));
  const allowedAmount = input.includeInTaxCalculation
    ? Math.min(calculatedAmount, Math.max(0, Number(input.availableBusinessProfit || 0)))
    : 0;

  return {
    calculatedAmount,
    allowedAmount,
    unusedCappedAmount: Math.max(0, calculatedAmount - allowedAmount),
    cappedSquareFeet,
    isSquareFootageCapped: squareFeet > 300,
  };
}

export function useHomeOfficeDeductions(taxYear?: number) {
  return useQuery({
    queryKey: ["home_office_deductions", taxYear],
    queryFn: async () => {
      let query = (supabase as any)
        .from("home_office_deductions")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (taxYear !== undefined) query = query.eq("tax_year", taxYear);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as HomeOfficeDeduction[];
    },
  });
}

type UpsertHomeOfficeDeduction = Omit<HomeOfficeDeduction, "id" | "user_id" | "organization_id" | "deduction_type" | "status" | "created_at" | "updated_at">;

export function useSaveHomeOfficeDeduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpsertHomeOfficeDeduction & { id?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const row = {
        user_id: user.id,
        organization_id: orgId,
        company_id: payload.company_id,
        include_in_tax_calculation: payload.include_in_tax_calculation,
        method: payload.method,
        square_feet: payload.square_feet,
        prior_year_amount: payload.prior_year_amount,
        calculated_amount: payload.calculated_amount,
        allowed_amount: payload.allowed_amount,
        unused_capped_amount: payload.unused_capped_amount,
        tax_year: payload.tax_year,
      };
      const { error } = payload.id
        ? await (supabase as any).from("home_office_deductions").update(row).eq("id", payload.id)
        : await (supabase as any).from("home_office_deductions").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_office_deductions"] });
      toast.success("Home office deduction saved");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteHomeOfficeDeduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("home_office_deductions")
        .update({ status: "deleted" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_office_deductions"] });
      toast.success("Home office deduction deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}