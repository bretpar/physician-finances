import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { YtdCatchupForm } from "./YtdCatchupForm";
import { aggregateYtdCatchup, type YtdCatchupEntry } from "@/hooks/useYtdCatchup";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
const mockTaxSettings = vi.hoisted(() => ({
  current: { stateTaxEnabled: true, filingStatus: "single" as const },
}));

// Stub hooks the form depends on so we can render it in isolation.
vi.mock("@/hooks/useYtdCatchup", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useYtdCatchup")>(
    "@/hooks/useYtdCatchup",
  );
  return {
    ...actual,
    useUpsertYtdCatchup: () => ({ mutateAsync, isPending: false }),
    useYtdCatchupEntries: () => ({ data: [] }),
    useDeleteYtdCatchup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});
vi.mock("@/hooks/useIncome", () => ({
  useIncomeEntries: () => ({ data: [] }),
}));
vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({ data: mockTaxSettings.current }),
}));


function renderForm(profile?: "w2_only" | "w2_plus_business" | "business_only") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <YtdCatchupForm incomeProfileType={profile} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mutateAsync.mockClear();
  mockTaxSettings.current = { stateTaxEnabled: true, filingStatus: "single" };
});

describe("YtdCatchupForm — Step 3 field visibility & source locking", () => {
  it("w2_only: locks source to W-2 paystub and shows W-2 payroll fields", () => {
    renderForm("w2_only");
    // Source dropdown hidden
    expect(screen.queryByText(/Income source type/i)).not.toBeInTheDocument();
    // W-2 fields visible
    expect(screen.getByText(/Federal withheld YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/State withheld YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/Social Security YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/Medicare YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/Pre-tax deductions YTD/i)).toBeInTheDocument();
    // 1099-style labels NOT shown
    expect(screen.queryByText(/Federal estimated taxes paid YTD/i)).not.toBeInTheDocument();
  });

  it("business_only: locks source to 1099/K-1 and hides W-2-only fields", () => {
    renderForm("business_only");
    expect(screen.getByText(/1099 \/ K-1 business income/i)).toBeInTheDocument();
    expect(screen.queryByText(/Income source type/i)).not.toBeInTheDocument();
    // 1099 estimated-tax labels
    expect(screen.getByText(/Federal estimated taxes paid YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/State estimated taxes paid YTD/i)).toBeInTheDocument();
    // W-2-only fields hidden
    expect(screen.queryByText(/Social Security YTD/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Medicare YTD/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pre-tax deductions YTD/i)).not.toBeInTheDocument();
  });

  it("w2_plus_business: shows source dropdown and no locked banner", () => {
    renderForm("w2_plus_business");
    expect(screen.queryByText(/Income type:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Income source type/i)).toBeInTheDocument();
    // Default sourceType is W-2, so W-2 fields visible
    expect(screen.getByText(/Federal withheld YTD/i)).toBeInTheDocument();
    expect(screen.getByText(/Social Security YTD/i)).toBeInTheDocument();
  });

  it("w2_only + MFJ prop: spouse attribution is deferred for MVP — owner control is hidden and saves as household taxpayer", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const year = new Date().getFullYear();
    const spouseInitial: YtdCatchupEntry = {
      id: "spouse-ytd",
      user_id: "u",
      organization_id: null,
      tax_year: year,
      source_type: "w2",
      owner_person: "spouse",
      company_id: null,
      company_name: "Spouse Hospital W2",
      period_start: `${year}-01-01`,
      period_end: `${year}-06-30`,
      gross_income: 50000,
      business_expenses: 0,
      federal_withholding: 7000,
      state_withholding: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
      retirement_401k: 0,
      hsa_contribution: 0,
      healthcare_premiums: 0,
      dental_vision: 0,
      other_pretax: 0,
      post_tax_deductions: 0,
      notes: "",
      created_at: "",
      updated_at: "",
    };
    render(
      <QueryClientProvider client={qc}>
        <YtdCatchupForm incomeProfileType="w2_only" filingStatus="married_filing_jointly" initial={spouseInitial} />
      </QueryClientProvider>,
    );

    // MVP: spouse selector is hidden.
    expect(screen.queryByText(/Whose W-2 is this/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("ytd-catchup-owner-person-select")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ytd-catchup-save"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    // Persists as household taxpayer regardless of prior owner.
    expect(mutateAsync.mock.calls[0][0].owner_person).toBe("taxpayer");
  });
});

// Dynamic Step 3 heading rendered by Onboarding.tsx — covered with a small helper.
function headingFor(profile: "w2_only" | "w2_plus_business" | "business_only") {
  return profile === "w2_only"
    ? "Add your W-2 income from earlier this year"
    : profile === "business_only"
      ? "Add your business income earned so far this year"
      : "Add your income earned so far this year";
}

describe("Step 3 heading copy by income profile", () => {
  it("uses W-2 heading for w2_only", () => {
    expect(headingFor("w2_only")).toBe("Add your W-2 income from earlier this year");
  });
  it("uses business heading for business_only", () => {
    expect(headingFor("business_only")).toBe("Add your business income earned so far this year");
  });
  it("uses combined heading for w2_plus_business", () => {
    expect(headingFor("w2_plus_business")).toBe("Add your income earned so far this year");
  });
});

describe("YtdCatchupForm — 1099-only business expenses & net profit", () => {
  it("shows business expenses field and computes net profit (85000 - 18000 = 67000)", async () => {
    mutateAsync.mockClear();
    renderForm("business_only");

    fireEvent.change(screen.getByTestId("ytd-catchup-company-name"), {
      target: { value: "Consulting LLC" },
    });
    fireEvent.change(screen.getByTestId("ytd-catchup-gross-income"), {
      target: { value: "85000" },
    });
    const expensesInput = screen.getByTestId("ytd-catchup-business-expenses");
    fireEvent.change(expensesInput, { target: { value: "18000" } });

    // Net profit shown to user
    expect(screen.getByTestId("ytd-catchup-net-profit").textContent).toMatch(/\$67,000/);

    fireEvent.click(screen.getByTestId("ytd-catchup-save"));
    // wait a tick for the async submit
    await Promise.resolve();
    await Promise.resolve();

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.source_type).toBe("1099_k1");
    expect(payload.gross_income).toBe(85000);
    expect(payload.business_expenses).toBe(18000);
  });

  it("aggregateYtdCatchup returns netBusinessProfit = gross - business_expenses for 1099/K-1 entries", () => {
    const year = new Date().getFullYear();
    const entry: YtdCatchupEntry = {
      id: "1",
      user_id: "u",
      organization_id: null,
      tax_year: year,
      source_type: "1099_k1",
      owner_person: "taxpayer",
      company_id: null,
      company_name: "Consulting LLC",
      period_start: `${year}-01-01`,
      period_end: `${year}-06-30`,
      gross_income: 85000,
      business_expenses: 18000,
      federal_withholding: 0,
      state_withholding: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
      retirement_401k: 0,
      hsa_contribution: 0,
      healthcare_premiums: 0,
      dental_vision: 0,
      other_pretax: 0,
      post_tax_deductions: 0,
      notes: "",
      created_at: "",
      updated_at: "",
    };
    const totals = aggregateYtdCatchup([entry], year);
    expect(totals.grossIncome).toBe(85000);
    expect(totals.businessExpenses).toBe(18000);
    expect(totals.netBusinessProfit).toBe(67000);
  });

  it("does not show W-2 payroll fields when business_only", () => {
    renderForm("business_only");
    expect(screen.queryByTestId("ytd-catchup-ss-withheld")).toBeNull();
    expect(screen.queryByTestId("ytd-catchup-medicare-withheld")).toBeNull();
    expect(screen.queryByText(/Pre-tax deductions YTD/i)).not.toBeInTheDocument();
  });
});

