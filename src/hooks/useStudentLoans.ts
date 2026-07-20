import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { RepaymentPlanId } from "@/lib/studentLoan/repaymentPlans";

export interface StudentLoanRow {
  id: string;
  user_id: string;
  name: string | null;
  loan_type: "federal" | "private";
  balance: number;
  interest_rate: number;
  current_monthly_payment: number | null;
  additional_monthly_payment: number | null;
  months_in_repayment: number | null;
  repayment_plan: RepaymentPlanId;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const QK = ["student_loans"] as const;

export function useStudentLoans() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QK, user?.id ?? "anon"],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_loans" as any)
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as StudentLoanRow[];
    },
  });
}

export type UpsertStudentLoanInput = Partial<Omit<StudentLoanRow, "id" | "user_id" | "created_at" | "updated_at">> & {
  id?: string;
};

export function useUpsertStudentLoan() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: UpsertStudentLoanInput) => {
      if (!user?.id) throw new Error("Not signed in");
      const payload: Record<string, unknown> = { ...input };
      delete payload.id;
      if (input.id) {
        const { data, error } = await supabase
          .from("student_loans" as any)
          .update(payload as any)
          .eq("id", input.id)
          .eq("user_id", user.id)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        return data as unknown as StudentLoanRow;
      }
      const insertPayload = { ...payload, user_id: user.id };
      const { data, error } = await supabase
        .from("student_loans" as any)
        .insert(insertPayload as any)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as StudentLoanRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("Loan saved");
    },
    onError: (e: any) => toast.error(e?.message || "Could not save loan"),
  });
}

export function useDeleteStudentLoan() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("student_loans" as any)
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("Loan removed");
    },
    onError: (e: any) => toast.error(e?.message || "Could not remove loan"),
  });
}
