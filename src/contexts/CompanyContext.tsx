import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface Company {
  id: string;
  name: string;
  companyType: "1099" | "W2" | "K1";
  includeInTax: boolean;
}

export const DEFAULT_COMPANIES: Company[] = [
  { id: "c1", name: "Vituity", companyType: "K1", includeInTax: true },
  { id: "c2", name: "WWEP", companyType: "1099", includeInTax: true },
  { id: "c3", name: "Veterans Affairs", companyType: "W2", includeInTax: true },
  { id: "c4", name: "Virginia Mason", companyType: "W2", includeInTax: true },
  { id: "c5", name: "Optum", companyType: "W2", includeInTax: true },
];

interface CompanyContextValue {
  companies: Company[];
  addCompany: (company: Company) => void;
  updateCompany: (id: string, updates: Partial<Company>) => void;
  removeCompany: (id: string) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>(DEFAULT_COMPANIES);

  const addCompany = useCallback((company: Company) => {
    setCompanies((prev) => [...prev, company]);
  }, []);

  const updateCompany = useCallback((id: string, updates: Partial<Company>) => {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  }, []);

  const removeCompany = useCallback((id: string) => {
    setCompanies((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return (
    <CompanyContext.Provider value={{ companies, addCompany, updateCompany, removeCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanies() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompanies must be used within CompanyProvider");
  return ctx;
}
