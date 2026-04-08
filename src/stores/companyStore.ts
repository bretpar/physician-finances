import { create } from "zustand";

export interface Company {
  id: string;
  name: string;
  companyType: "1099" | "W2" | "K1";
  includeInTax: boolean;
}

interface CompanyStore {
  companies: Company[];
  setCompanies: (companies: Company[]) => void;
  addCompany: (company: Company) => void;
  updateCompany: (id: string, updates: Partial<Company>) => void;
  removeCompany: (id: string) => void;
}

export const DEFAULT_COMPANIES: Company[] = [
  { id: "c1", name: "Vituity", companyType: "K1", includeInTax: true },
  { id: "c2", name: "WWEP", companyType: "1099", includeInTax: true },
  { id: "c3", name: "Veterans Affairs", companyType: "W2", includeInTax: true },
  { id: "c4", name: "Virginia Mason", companyType: "W2", includeInTax: true },
  { id: "c5", name: "Optum", companyType: "W2", includeInTax: true },
];

export const useCompanyStore = create<CompanyStore>((set) => ({
  companies: DEFAULT_COMPANIES,
  setCompanies: (companies) => set({ companies }),
  addCompany: (company) => set((s) => ({ companies: [...s.companies, company] })),
  updateCompany: (id, updates) =>
    set((s) => ({
      companies: s.companies.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  removeCompany: (id) =>
    set((s) => ({ companies: s.companies.filter((c) => c.id !== id) })),
}));
