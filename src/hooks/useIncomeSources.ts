import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export type SourceKind =
  | "w2_employer"
  | "personal"
  | "1099_schedule_c"
  | "k1_partnership"
  | "s_corp"
  | "other_business";

export const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string; group: "personal" | "business" }[] = [
  { value: "w2_employer", label: "W-2 / Employer", group: "personal" },
  { value: "personal", label: "Personal Income Source", group: "personal" },
  { value: "1099_schedule_c", label: "1099 / Schedule C", group: "business" },
  { value: "k1_partnership", label: "K-1 / Partnership", group: "business" },
  { value: "s_corp", label: "S-Corp", group: "business" },
  { value: "other_business", label: "Other Business", group: "business" },
];

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = Object.fromEntries(
  SOURCE_KIND_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SourceKind, string>;

export interface IncomeSource {
  id: string;
  name: string;
  nickname: string;
  source_kind: SourceKind;
  company_type: string;
}

export function isPersonalKind(kind: SourceKind | string | null | undefined): boolean {
  return kind === "w2_employer" || kind === "personal";
}

/** Fetch all income sources (companies table) usable in the unified dropdown. */
export function useIncomeSources() {
  return useQuery({
    queryKey: ["income_sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, nickname, source_kind, company_type, archived_at")
        .is("archived_at", null)
        .order("name");
      if (error) throw error;
      return ((data || []) as any[])
        .filter((c) => !!(c.name || c.nickname))
        .map((c) => ({
          id: c.id,
          name: c.name,
          nickname: c.nickname,
          source_kind: c.source_kind,
          company_type: c.company_type,
        })) as IncomeSource[];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

/** Create a brand-new source from the income flow's "Save as new source" UX. */
export function useCreateIncomeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, source_kind }: { name: string; source_kind: SourceKind }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      // Map source_kind back to a sensible legacy company_type so existing logic still works.
      const company_type =
        source_kind === "w2_employer" ? "w2" :
        source_kind === "personal" ? "personal" :
        source_kind;
      const { data, error } = await supabase
        .from("companies")
        .insert({
          user_id: user.id,
          organization_id: orgId,
          name: name.trim(),
          nickname: name.trim(),
          company_type,
          source_kind,
          include_in_tax: true,
        } as any)
        .select("id, name, nickname, source_kind, company_type")
        .single();
      if (error) throw error;
      return data as IncomeSource;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_sources"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      toast.success("Source saved");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to save source"),
  });
}
