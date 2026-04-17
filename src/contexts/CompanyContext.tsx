import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toast } from "sonner";
import type { FilingType } from "@/lib/filingTypes";
import { normalizeFilingType } from "@/lib/filingTypes";

export interface Company {
  id: string;
  name: string;
  /** Tax / Filing Type — see src/lib/filingTypes.ts */
  companyType: FilingType;
  includeInTax: boolean;
}

export const DEFAULT_COMPANIES: Company[] = [
  { id: "c1", name: "Vituity", companyType: "k1_partnership", includeInTax: true },
  { id: "c2", name: "WWEP", companyType: "1099_schedule_c", includeInTax: true },
  { id: "c3", name: "Veterans Affairs", companyType: "w2", includeInTax: true },
  { id: "c4", name: "Virginia Mason", companyType: "w2", includeInTax: true },
  { id: "c5", name: "Optum", companyType: "w2", includeInTax: true },
];

interface CompanyContextValue {
  companies: Company[];
  addCompany: (company: Omit<Company, "id">) => Promise<void>;
  updateCompany: (id: string, updates: Partial<Company>) => Promise<void>;
  removeCompany: (id: string) => Promise<void>;
  loading: boolean;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
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
      (data || []).map((c) => ({
        id: c.id,
        name: c.name,
        companyType: normalizeFilingType(c.company_type),
        includeInTax: c.include_in_tax,
      }))
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const addCompany = useCallback(async (company: Omit<Company, "id">) => {
    if (!user) return;
    const orgId = await getUserOrgId();
    const { error } = await supabase.from("companies").insert({
      user_id: user.id,
      organization_id: orgId,
      name: company.name,
      company_type: company.companyType,
      include_in_tax: company.includeInTax,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Company added");
    loadCompanies();
  }, [user, loadCompanies]);

  const updateCompany = useCallback(async (id: string, updates: Partial<Company>) => {
    const dbUpdates: {
      name?: string;
      company_type?: string;
      include_in_tax?: boolean;
    } = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.companyType !== undefined) dbUpdates.company_type = updates.companyType;
    if (updates.includeInTax !== undefined) dbUpdates.include_in_tax = updates.includeInTax;

    const { error } = await supabase.from("companies").update(dbUpdates).eq("id", id);
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
    <CompanyContext.Provider value={{ companies, addCompany, updateCompany, removeCompany, loading }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanies() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompanies must be used within CompanyProvider");
  return ctx;
}
