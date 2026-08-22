import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PersonalIncome from "@/pages/PersonalIncome";

/**
 * UI snapshot coverage for the W-2 "Paycheck Target" savings card.
 *
 * The card must:
 *   - credit ONLY federal income tax withholding (never SS/Medicare), and
 *   - completely ignore the quarterly catch-up amount coming from the annual
 *     withholding recommendation engine.
 *
 * Rendering happens through the real page so the snapshot captures the actual
 * numbers the user sees, not a re-implementation of the math.
 */

// Quarterly catch-up returned by the annual engine — the W-2 card must ignore it.
let mockCatchUpApplied = 0;

vi.mock("@/hooks/usePersonalIncome", () => ({
  usePersonalIncomeEntries: () => ({ data: [], isLoading: false }),
  useAddPersonalIncome: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePersonalIncome: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePersonalIncome: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompanies: () => ({ companies: [] }),
}));

vi.mock("@/hooks/useAttachments", () => ({
  ALLOWED_MIME: new Set(["image/png", "image/jpeg", "application/pdf"]),
  MAX_ATTACHMENTS: 5,
  useAttachmentCounts: () => ({ data: new Map() }),
  useTransactionAttachments: () => ({ data: [], isLoading: false }),
  useSignedAttachmentUrl: () => ({ data: null, isLoading: false }),
  useUploadAttachments: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useIncomeSources", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useIncomeSources")>("@/hooks/useIncomeSources");
  return {
    ...actual,
    useIncomeSources: () => ({ data: [], isLoading: false }),
    useCreateIncomeSource: () => ({ mutateAsync: vi.fn() }),
  };
});

// Flat manual rate keeps the paycheck target deterministic: 17.2%.
vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({
    data: {
      stateIncomeTaxEnabled: false,
      withholdingMethod: "flat_estimate",
      manualEffectiveTaxRate: 17.2,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useTaxEstimate", () => ({
  useTaxEstimate: () => ({ actualEstimate: null, currentPaceEstimate: null, forecastEstimate: null }),
}));

vi.mock("@/hooks/useWithholdingRecommendation", () => ({
  useWithholdingRecommendation: () => ({
    getRecommendation: () => ({
      catchUpApplied: mockCatchUpApplied,
      rateBreakdown: { rate: 17.2, components: {} },
    }),
  }),
}));

vi.mock("@/hooks/useIncomeRecommendation", () => ({
  useIncomeRecommendation: () => ({ getRecommendation: vi.fn() }),
}));

// Advanced savings guidance is Premium-gated; unlock it for the snapshot.
vi.mock("@/hooks/useFeatureAccess", () => ({
  useFeatureAccess: () => ({ can: () => true, isLoading: false }),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PersonalIncome />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * Open the Add form and enter a W-2 paycheck:
 *   gross $4,230 • federal income tax $337.14 • SS $262 • Medicare $58
 * Target = 4230 × 17.2% = $727.56 → additional savings = $390.42 → $390.
 */
function fillW2Paycheck() {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  fireEvent.change(screen.getByTestId("paycheck-gross-input"), { target: { value: "4230" } });
  fireEvent.click(screen.getByTestId("paycheck-federal-breakdown-toggle"));
  fireEvent.change(screen.getByTestId("paycheck-federal-withholding-input"), {
    target: { value: "337.14" },
  });
  fireEvent.change(screen.getByTestId("paycheck-social-security-input"), { target: { value: "262" } });
  fireEvent.change(screen.getByTestId("paycheck-medicare-input"), { target: { value: "58" } });
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("W-2 Paycheck Target card UI", () => {
  beforeEach(() => {
    mockCatchUpApplied = 0;
  });

  it("renders federal-income-tax-only guidance (snapshot)", () => {
    fillW2Paycheck();
    const card = screen.getByTestId("w2-additional-tax-savings");

    expect(norm(card.textContent || "")).toMatchInlineSnapshot(
      `"Additional Savings RecommendedBased on this paycheck's federal income tax target, consider saving an additional $390 from this paycheck.Additional savings$390Federal income tax already withheld from this paycheck is included in this recommendation. Social Security and Medicare are handled separately.Federal income tax$337Social Security$262Medicare$58Want your employer to withhold this automatically? Open the W-4 Calculator →"`,
    );
  });

  it("credits only federal income tax withholding in the breakdown", () => {
    fillW2Paycheck();
    // $337 federal credit only: 727.56 − 337.14 = 390.42 → $390 recommended.
    expect(screen.getByTestId("w2-breakdown-federal").textContent).toBe("$337");
    expect(screen.getByTestId("w2-additional-tax-savings").textContent).toContain("$390");
  });

  it("ignores the quarterly catch-up amount", () => {
    mockCatchUpApplied = 0;
    fillW2Paycheck();
    const withoutCatchUp = norm(screen.getByTestId("w2-additional-tax-savings").textContent || "");

    cleanup();

    mockCatchUpApplied = 759;
    fillW2Paycheck();
    const withCatchUp = norm(screen.getByTestId("w2-additional-tax-savings").textContent || "");

    expect(withCatchUp).toBe(withoutCatchUp);
    expect(withCatchUp).toContain("$390");
    expect(withCatchUp).not.toContain("1,149");
  });
});
