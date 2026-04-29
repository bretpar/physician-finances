import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PersonalIncome from "@/pages/PersonalIncome";
import type { PersonalIncomeEntry } from "@/hooks/usePersonalIncome";

let mockEntries: PersonalIncomeEntry[] = [];

vi.mock("@/hooks/usePersonalIncome", () => ({
  usePersonalIncomeEntries: () => ({ data: mockEntries, isLoading: false }),
  useAddPersonalIncome: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePersonalIncome: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePersonalIncome: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompanies: () => ({ companies: [] }),
}));

vi.mock("@/hooks/useAttachments", () => ({
  ALLOWED_MIME: new Set(["image/png", "image/jpeg", "application/pdf"]),
  useAttachmentCounts: () => ({ data: {} }),
  useUploadAttachments: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useIncomeSources", () => ({
  useCreateIncomeSource: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({ data: { stateIncomeTaxEnabled: false }, isLoading: false }),
}));

vi.mock("@/hooks/useTaxEstimate", () => ({
  useTaxEstimate: () => ({ actualEstimate: null, currentPaceEstimate: null, forecastEstimate: null }),
}));

vi.mock("@/hooks/useWithholdingRecommendation", () => ({
  useWithholdingRecommendation: () => ({ getRecommendation: vi.fn() }),
}));

vi.mock("@/hooks/useIncomeRecommendation", () => ({
  useIncomeRecommendation: () => ({ getRecommendation: vi.fn() }),
}));

function personalEntry(overrides: Partial<PersonalIncomeEntry>): PersonalIncomeEntry {
  return {
    id: "entry-1",
    user_id: "user-1",
    organization_id: "org-1",
    name: "Legacy dividend",
    company: "Brokerage",
    source_id: null,
    income_type: "other",
    ui_income_subtype: "dividend",
    income_date: "2026-04-01",
    gross_amount: 300,
    paycheck_amount: 300,
    deposited_amount: 300,
    cost_basis: null,
    realized_gain_loss: null,
    federal_withholding: 0,
    state_withholding: 0,
    ss_withholding: 0,
    medicare_withholding: 0,
    taxes_withheld: 0,
    pre_tax_deductions: 0,
    retirement_401k: 0,
    healthcare_deduction: 0,
    hsa_contribution: 0,
    source_bucket: "personal",
    tax_category: "ordinary",
    is_actual: true,
    include_in_tax_estimate: true,
    include_in_cash_flow: false,
    notes: "",
    status: "received",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PersonalIncome />
    </QueryClientProvider>,
  );
}

describe("PersonalIncome investment input cleanup", () => {
  beforeEach(() => {
    mockEntries = [];
  });

  it("removes investment options from new Personal Income entries", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.mouseDown(screen.getByRole("combobox"));

    expect(screen.queryByRole("option", { name: /short-term capital gain/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /long-term capital gain/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^dividend$/i })).not.toBeInTheDocument();
  });

  it("preserves historical dividend rows in the Personal Income ledger", () => {
    mockEntries = [personalEntry({ id: "legacy-dividend", name: "Legacy dividend", ui_income_subtype: "dividend", gross_amount: 300 })];
    renderPage();

    const row = screen.getByText("Legacy dividend").closest("div")?.parentElement?.parentElement ?? screen.getByText("Legacy dividend").closest("div")!;
    expect(screen.getByText("Legacy dividend")).toBeInTheDocument();
    expect(screen.getByText("Dividend")).toBeInTheDocument();
    expect(within(row).getByText(/\$300\.00/)).toBeInTheDocument();
  });
});
