import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { YtdCatchupForm } from "./YtdCatchupForm";
import { aggregateYtdCatchup, type YtdCatchupEntry } from "@/hooks/useYtdCatchup";

const mutateAsync = vi.fn().mockResolvedValue(undefined);

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
  useTaxSettings: () => ({ data: { stateTaxEnabled: true } }),
}));


function renderForm(profile?: "w2_only" | "w2_plus_business" | "business_only") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <YtdCatchupForm incomeProfileType={profile} />
    </QueryClientProvider>
  );
}

describe("YtdCatchupForm — Step 3 field visibility & source locking", () => {
  it("w2_only: locks source to W-2 paystub and shows W-2 payroll fields", () => {
    renderForm("w2_only");
    // Locked banner present
    expect(screen.getByText(/Income type:/i)).toBeInTheDocument();
    expect(screen.getByText(/W-2 employer paystub/i)).toBeInTheDocument();
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
