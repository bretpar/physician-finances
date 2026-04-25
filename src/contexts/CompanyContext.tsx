import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toast } from "sonner";
import type { FilingType, ToggleKey } from "@/lib/filingTypes";
import { normalizeFilingType } from "@/lib/filingTypes";

export type SetasideMethod = "recommended" | "flat_percentage" | "none";

export interface Company {
  id: string;
  name: string;
  nickname: string;
  /** Tax / Filing Type — see src/lib/filingTypes.ts */
  companyType: FilingType;
  includeInTax: boolean;
  defaultSetasideMethod: SetasideMethod;
  defaultSetasidePct: number | null;
  notes: string;
  /**
   * Per-company toggle map: which optional fields appear in the Add/Edit
   * Income form's Advanced section. Empty/missing keys fall back to the
   * filing-type defaults from DEFAULT_TOGGLES_BY_TYPE.
   */
  advancedFieldVisibility: Partial<Record<ToggleKey, boolean>>;
  /** Apply business state tax (set in Tax Profile) to this specific company. Default true. */
  applyBusinessStateTax: boolean;
  /** Include self-employment tax in per-entry savings recommendations. Default true. */
  includeSETaxInRecommendation: boolean;
}

export const DEFAULT_COMPANIES: Company[] = [];

interface CompanyContextValue {
  companies: Company[];
  /** Map of company name → number of saved income_entries. Drives filing-type lock. */
  incomeCountByCompanyName: Record<string, number>;
  addCompany: (company: Omit<Company, "id">) => Promise<void>;
  updateCompany: (id: string, updates: Partial<Company>) => Promise<void>;
  removeCompany: (id: string) => Promise<void>;
  loading: boolean;
  refreshIncomeCounts: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [incomeCountByCompanyName, setIncomeCountByCompanyName] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const loadCompanies = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .order("name");

    if (error) {
      console.error("Failed to load companies", error);
      setLoading(false);
      return;
    }

    setCompanies(
      (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        nickname: c.nickname || "",
        companyType: normalizeFilingType(c.company_type),
        includeInTax: c.include_in_tax,
        defaultSetasideMethod: (c.default_setaside_method || "recommended") as SetasideMethod,
        defaultSetasidePct: c.default_setaside_pct ?? null,
        notes: c.notes || "",
        advancedFieldVisibility:
          (c.advanced_field_visibility as Partial<Record<ToggleKey, boolean>>) || {},
        applyBusinessStateTax: c.apply_business_state_tax !== false,
        includeSETaxInRecommendation: c.include_se_tax_in_recommendation !== false,
      }))
    );
    setLoading(false);
  }, [user]);

  const refreshIncomeCounts = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from("income_entries").select("company");
    if (error) return;
    const counts: Record<string, number> = {};
    for (const row of data || []) {
      const name = (row as any).company || "";
      counts[name] = (counts[name] || 0) + 1;
    }
    setIncomeCountByCompanyName(counts);
  }, [user]);

  useEffect(() => {
    loadCompanies();
    refreshIncomeCounts();
  }, [loadCompanies, refreshIncomeCounts]);

  const addCompany = useCallback(async (company: Omit<Company, "id">) => {
    if (!user) return;
    const orgId = await getUserOrgId();
    const { error } = await supabase.from("companies").insert({
      user_id: user.id,
      organization_id: orgId,
      name: company.name,
      nickname: company.nickname,
      company_type: company.companyType,
      include_in_tax: company.includeInTax,
      default_setaside_method: company.defaultSetasideMethod,
      default_setaside_pct: company.defaultSetasidePct,
      notes: company.notes,
      advanced_field_visibility: company.advancedFieldVisibility ?? {},
      apply_business_state_tax: company.applyBusinessStateTax ?? true,
      include_se_tax_in_recommendation: company.includeSETaxInRecommendation ?? true,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Company added");
    loadCompanies();
  }, [user, loadCompanies]);

  const updateCompany = useCallback(async (id: string, updates: Partial<Company>) => {
    const dbUpdates: Record<string, any> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.nickname !== undefined) dbUpdates.nickname = updates.nickname;
    if (updates.companyType !== undefined) dbUpdates.company_type = updates.companyType;
    if (updates.includeInTax !== undefined) dbUpdates.include_in_tax = updates.includeInTax;
    if (updates.defaultSetasideMethod !== undefined) dbUpdates.default_setaside_method = updates.defaultSetasideMethod;
    if (updates.defaultSetasidePct !== undefined) dbUpdates.default_setaside_pct = updates.defaultSetasidePct;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.advancedFieldVisibility !== undefined) dbUpdates.advanced_field_visibility = updates.advancedFieldVisibility;
    if (updates.applyBusinessStateTax !== undefined) dbUpdates.apply_business_state_tax = updates.applyBusinessStateTax;
    if (updates.includeSETaxInRecommendation !== undefined) dbUpdates.include_se_tax_in_recommendation = updates.includeSETaxInRecommendation;

    const { error } = await supabase.from("companies").update(dbUpdates as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    loadCompanies();
  }, [loadCompanies]);

  const removeCompany = useCallback(async (id: string) => {
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Company removed");
    loadCompanies();
  }, [loadCompanies]);

  return (
    <CompanyContext.Provider value={{ companies, incomeCountByCompanyName, addCompany, updateCompany, removeCompany, loading, refreshIncomeCounts }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanies() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompanies must be used within CompanyProvider");
  return ctx;
}
