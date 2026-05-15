import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InvestmentIncome from "@/pages/InvestmentIncome";
import type { InvestmentIncomeEntry } from "@/hooks/useInvestmentIncome";

let mockEntries: InvestmentIncomeEntry[] = [];
const addMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const getRecommendation = vi.fn();

vi.mock("@/hooks/useInvestmentIncome", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useInvestmentIncome")>("@/hooks/useInvestmentIncome");
  return {
    ...actual,
    useInvestmentIncomeEntries: () => ({ data: mockEntries, isLoading: false }),
    useAddInvestmentIncomeEntry: () => ({ mutate: addMutate, isPending: false }),
    useUpdateInvestmentIncomeEntry: () => ({ mutate: updateMutate, isPending: false }),
    useDeleteInvestmentIncomeEntry: () => ({ mutate: deleteMutate, isPending: false }),
  };
});

vi.mock("@/hooks/useIncomeRecommendation", () => ({
  useIncomeRecommendation: () => ({ getRecommendation }),
}));

vi.mock("@/hooks/useTaxEstimate", () => ({
  useTaxEstimate: () => ({ forecastEstimate: { taxableIncome: 200000 }, actualEstimate: { taxableIncome: 200000 } }),
}));

vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({ data: { filingStatus: "married_filing_jointly", householdIncomeStreams: { investmentIncome: true } } }),
}));

function entry(overrides: Partial<InvestmentIncomeEntry>): InvestmentIncomeEntry {
  return {
    id: "entry-1",
    user_id: "user-1",
    organization_id: "org-1",
    entry_date: "2026-04-15",
    investment_income_type: "short_term_sale",
    asset_name_or_ticker: "AAPL",
    sale_proceeds: 20000,
    cost_basis: 12000,
    taxable_amount: 8000,
    tax_recommendation: 2400,
    notes: "",
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "2026-04-15T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvestmentIncome />
    </QueryClientProvider>,
  );
}

describe("InvestmentIncome page", () => {
  beforeEach(() => {
    mockEntries = [];
    addMutate.mockReset();
    updateMutate.mockReset();
    deleteMutate.mockReset();
    getRecommendation.mockReset();
    getRecommendation.mockReturnValue({ baseTaxEstimate: 2400, effectiveRate: 30 });
  });

  it("creates short-term sales using taxable amount, not sale proceeds, for tax recommendation", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. AAPL"), { target: { value: "AAPL" } });
    // Sale-detail inputs are inside a collapsed section by default — expand it first.
    fireEvent.click(screen.getByText(/calculate taxable amount from sale details/i));
    fireEvent.change(screen.getByLabelText(/total sale proceeds/i), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText(/cost basis/i), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: /save entry/i }));

    await waitFor(() => expect(addMutate).toHaveBeenCalled());
    // Short-term sales use the ordinary-income tax method against the taxable gain.
    expect(addMutate.mock.calls[0][0]).toEqual(expect.objectContaining({
      investment_income_type: "short_term_sale",
      sale_proceeds: 20000,
      cost_basis: 12000,
      taxable_amount: 8000,
      tax_method_used: "short_term_ordinary",
    }));
    expect(addMutate.mock.calls[0][0].tax_recommendation).toBeGreaterThan(0);
  });

  it("creates dividends without requiring sale proceeds or cost basis", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("combobox", { name: /investment income type/i }));
    fireEvent.click(screen.getByRole("option", { name: /^dividend$/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. VTI dividend"), { target: { value: "VTI" } });
    fireEvent.change(screen.getByLabelText(/taxable dividend amount/i), { target: { value: "350" } });
    fireEvent.click(screen.getByRole("button", { name: /save entry/i }));

    await waitFor(() => expect(addMutate).toHaveBeenCalled());
    expect(addMutate.mock.calls[0][0]).toEqual(expect.objectContaining({
      investment_income_type: "dividend",
      sale_proceeds: null,
      cost_basis: null,
      taxable_amount: 350,
    }));
  });

  it("edits an existing ledger row instead of creating a duplicate", async () => {
    mockEntries = [entry({ id: "sale-1", asset_name_or_ticker: "MSFT", taxable_amount: 8000 })];
    renderPage();

    // Both desktop table and mobile list expose an Edit button — click the first (desktop).
    fireEvent.click(screen.getAllByRole("button", { name: /edit msft/i })[0]);
    fireEvent.change(screen.getByLabelText(/^taxable amount$/i), { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    expect(addMutate).not.toHaveBeenCalled();
    expect(updateMutate.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "sale-1", taxable_amount: 9000 }));
  });

  it("deletes an existing ledger row", async () => {
    mockEntries = [entry({ id: "div-1", asset_name_or_ticker: "SCHD", investment_income_type: "dividend", taxable_amount: 125, sale_proceeds: null, cost_basis: null })];
    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /delete schd/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith("div-1"));
  });

  it("renders gains in success color and losses in destructive color", () => {
    mockEntries = [
      entry({ id: "gain", asset_name_or_ticker: "GAIN", taxable_amount: 500 }),
      entry({ id: "loss", asset_name_or_ticker: "LOSS", taxable_amount: -250 }),
    ];
    renderPage();

    // Desktop table renders rows in <tr>; mobile list also renders the asset name
    // (jsdom ignores Tailwind's `hidden`/`md:hidden` classes), so scope to the first
    // matching desktop row by walking up to the closest <tr>.
    const gainCell = screen.getAllByText("GAIN").find((el) => el.closest("tr"))!;
    const lossCell = screen.getAllByText("LOSS").find((el) => el.closest("tr"))!;
    const gainRow = gainCell.closest("tr")!;
    const lossRow = lossCell.closest("tr")!;
    expect(within(gainRow).getByText("$500.00")).toHaveClass("text-success");
    expect(within(lossRow).getByText("-$250.00")).toHaveClass("text-destructive");
  });
});
