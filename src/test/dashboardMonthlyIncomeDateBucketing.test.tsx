import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Regression test: Dashboard monthly income bucketing must read date-only
 * strings (YYYY-MM-DD) as *local* calendar dates.
 *
 * `new Date("2026-11-01")` is UTC midnight — 17:00 Pacific on Oct 31 — so a
 * paycheck dated Nov 1 landed in October, and a Jan 1 entry fell out of the
 * current year entirely. The Dashboard fixture below reproduces the reported
 * case (Seattle Public Schools spousal W-2, $7,813 on 2026-11-01) and pins the
 * expected November figures: actual $7,813 + planned $39,090 = $46,903.
 */

vi.hoisted(() => {
  // The defect only shows in a timezone west of UTC.
  process.env.TZ = "America/Los_Angeles";
});

const fixtures = vi.hoisted(() => ({
  personal: [] as any[],
  transactions: [] as any[],
  incomeEntries: [] as any[],
  investmentEntries: [] as any[],
  streams: [] as any[],
  bonuses: [] as any[],
  overrides: [] as any[],
  plannerConversions: [] as any[],
}));

// ── Data hooks: fixtures are read at render time, so tests can rewrite them ──
vi.mock("@/hooks/useTransactions", () => ({
  useTransactions: () => ({ data: fixtures.transactions, isLoading: false }),
}));
vi.mock("@/hooks/useIncome", () => ({
  useIncomeEntries: () => ({ data: fixtures.incomeEntries, isLoading: false }),
}));
vi.mock("@/hooks/usePersonalIncome", () => ({
  usePersonalIncomeEntries: () => ({ data: fixtures.personal, isLoading: false }),
}));
vi.mock("@/hooks/useInvestmentIncome", async () => {
  const real = await import("@/hooks/useInvestmentIncome");
  return {
    ...real,
    useInvestmentIncomeEntries: () => ({ data: fixtures.investmentEntries, isLoading: false }),
  };
});
vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({
    data: {
      id: "rates-1",
      withholdingMethod: "dynamic_planner",
      manualEffectiveTaxRate: 25,
      householdIncomeStreams: { w2Income: true, spouseW2Income: true },
      enabledIncomeSources: { w2: true, form1099: true, k1: true },
      onboardingComplete: true,
      onboardingBannerDismissed: true,
    },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useTaxEstimate", () => ({
  useTaxEstimate: () => {
    const estimate = {
      totalTaxLiability: 40_000,
      totalGrossIncome: 150_000,
      federalEffectiveRate: 22,
      effectiveRate: 30,
    };
    const debug = {
      totalGrossIncome: 150_000,
      w2Income: 150_000,
      otherIncome: 0,
      countedCreditsTotal: 30_000,
      remainingTaxDue: 10_000,
      totalEstimatedTax: 40_000,
    };
    return {
      actualEstimate: estimate,
      currentPaceEstimate: estimate,
      forecastEstimate: estimate,
      actualDebug: debug,
      forecastDebug: debug,
      taxMode: "forecast",
      isLoading: false,
    };
  },
}));
vi.mock("@/hooks/useTaxPayments", () => ({ useTaxPayments: () => ({ data: [] }) }));
vi.mock("@/hooks/useTaxSavings", () => ({ useTaxSavings: () => ({ data: [] }) }));
vi.mock("@/hooks/useW4Calculation", () => ({
  useW4Calculation: () => ({ employerW4Recommendations: [] }),
}));
vi.mock("@/hooks/useFeatureAccess", () => ({
  useFeatureAccess: () => ({ can: () => true, isPremium: true }),
}));
vi.mock("@/hooks/useMileage", () => ({
  useMileageYTD: () => ({ data: [] }),
  getIrsMileageRate: () => 0.7,
}));
vi.mock("@/hooks/usePlaid", () => ({
  usePlaidItems: () => ({ data: [] }),
  useSyncTransactions: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useQuarterRecommendationInput", () => ({
  useQuarterRecommendationInput: () => ({
    annualTaxLiability: 40_000,
    federalIncomeTax: 30_000,
    selfEmploymentTax: 0,
    quarterMethod: "even",
    incomeEntries: [],
    personalEntries: [],
    transactions: [],
    investmentEntries: [],
    projectedPaychecks: [],
    payments: [],
    manualSavings: [],
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "test@example.com", user_metadata: {} } }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompanies: () => ({ companies: [], isLoading: false, closureLookup: null }),
  useOptionalCompanies: () => ({ companies: [], isLoading: false, closureLookup: null }),
}));

// Planner streams/bonuses come from fixtures; the paycheck generator and the
// monthly breakdown stay the real implementations, so planned totals (and the
// converted/matched exclusions) are exercised for real.
vi.mock("@/hooks/useProjectedIncome", async () => {
  const real = await import("@/hooks/useProjectedIncome");
  return {
    ...real,
    useProjectedStreams: () => ({ data: fixtures.streams, isLoading: false }),
    useProjectedBonuses: () => ({ data: fixtures.bonuses, isLoading: false }),
    useStreamOverrides: () => ({ data: fixtures.overrides, isLoading: false }),
    usePlannerConversions: () => ({ data: fixtures.plannerConversions, isLoading: false }),
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "then") return undefined;
        if (prop === "maybeSingle" || prop === "single") {
          return async () => ({ data: null, error: null });
        }
        return () => chain;
      },
    },
  );
  return {
    supabase: {
      from: () => chain,
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: { getUser: async () => ({ data: { user: null } }) },
    },
  };
});

// ── Heavy / unrelated dashboard children are stubbed. MonthlyIncomeCard and
// FinancialScore are replaced with prop recorders so the bucketing produced by
// the real Dashboard code can be asserted directly. ──
vi.mock("@/components/dashboard/MonthlyIncomeCard", () => ({
  default: (props: any) => (
    <div
      data-testid="monthly-card"
      data-months={JSON.stringify(props.months)}
      data-current={props.currentMonth}
      data-ytd={props.ytdIncome}
    />
  ),
}));
vi.mock("@/components/dashboard/FinancialScore", () => ({
  default: (props: any) => (
    <div
      data-testid="financial-score"
      data-months-with-income={props.monthsWithIncome}
      data-months-elapsed={props.monthsElapsed}
    />
  ),
}));
vi.mock("@/components/dashboard/QuarterlyTracker", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/QuarterlyPaymentCallout", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/AnnualIncomeHero", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/IncomeBreakdownCards", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/IncomeModeToggle", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/PaycheckConfetti", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/DashboardSkeleton", () => ({ default: () => <div /> }));

import Dashboard from "@/pages/Dashboard";

const YEAR = 2026;
// Nov 6, 2026 09:00 local (America/Los_Angeles).
const TODAY = new Date(2026, 10, 6, 9, 0, 0);

function stream(over: Record<string, any>) {
  return {
    id: "stream-1",
    user_id: "user-1",
    organization_id: null,
    company: "Employer",
    company_type: "w2",
    pay_frequency: "single",
    custom_interval_days: null,
    start_date: "2026-11-20",
    end_date: null,
    paycheck_amount: 0,
    taxes_withheld: 0,
    retirement_401k: 0,
    pre_tax_deductions: 0,
    is_active: true,
    include_in_tax: true,
    source_id: null,
    ui_income_subtype: null,
    federal_withholding: 0,
    state_withholding: 0,
    ss_withholding: 0,
    medicare_withholding: 0,
    healthcare_deduction: 0,
    hsa_contribution: 0,
    additional_tax_reserve: 0,
    notes: "",
    forecast_expense_per_period: 0,
    forecast_expense_notes: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function personal(over: Record<string, any>) {
  return {
    id: "pi-1",
    user_id: "user-1",
    income_date: "2026-11-01",
    gross_amount: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

async function renderDashboard() {
  const result = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  // Let the profile-name effect settle without act() warnings.
  await act(async () => {
    await Promise.resolve();
  });
  return result;
}

function monthlyCard() {
  const el = screen.getByTestId("monthly-card");
  return {
    months: JSON.parse(el.getAttribute("data-months") || "[]") as Array<{
      month: number;
      actual: number;
      planned: number;
    }>,
    currentMonth: Number(el.getAttribute("data-current")),
    ytd: Number(el.getAttribute("data-ytd")),
  };
}

function month(months: Array<{ month: number; actual: number; planned: number }>, index: number) {
  const m = months.find((x) => x.month === index);
  expect(m, `month ${index} missing`).toBeTruthy();
  return { actual: Math.round(m!.actual * 100) / 100, planned: Math.round(m!.planned * 100) / 100 };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  fixtures.personal = [];
  fixtures.transactions = [];
  fixtures.incomeEntries = [];
  fixtures.investmentEntries = [];
  fixtures.streams = [];
  fixtures.bonuses = [];
  fixtures.overrides = [];
  fixtures.plannerConversions = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Dashboard monthly income date bucketing (local calendar dates)", () => {
  it("puts a Nov 1 paycheck in November and reports the reported totals", async () => {
    fixtures.personal = [
      personal({
        id: "pi-spouse-w2",
        income_date: "2026-11-01",
        gross_amount: 7_813,
        source: "Seattle Public Schools (spouse)",
      }),
    ];
    fixtures.streams = [
      stream({ id: "s-nov", company: "Seattle Public Schools (spouse)", start_date: "2026-11-20", paycheck_amount: 39_090 }),
    ];

    await renderDashboard();
    const { months, currentMonth } = monthlyCard();

    expect(currentMonth).toBe(10); // November
    expect(month(months, 10)).toEqual({ actual: 7_813, planned: 39_090 });
    // The defect: UTC parsing moved Nov 1 into October.
    expect(month(months, 9)).toEqual({ actual: 0, planned: 0 });
    expect(month(months, 10).actual + month(months, 10).planned).toBe(46_903);
  });

  it("keeps a January 1 entry in January of the current year", async () => {
    fixtures.personal = [personal({ id: "pi-jan", income_date: "2026-01-01", gross_amount: 1_234 })];

    await renderDashboard();
    const { months, ytd } = monthlyCard();

    expect(month(months, 0)).toEqual({ actual: 1_234, planned: 0 });
    expect(month(months, 11)).toEqual({ actual: 0, planned: 0 });
    expect(ytd).toBeCloseTo(1_234, 2);
  });

  it("counts a converted planner occurrence once as actual, never again as planned", async () => {
    fixtures.personal = [
      personal({ id: "pi-spouse-w2", income_date: "2026-11-01", gross_amount: 7_813 }),
      personal({ id: "pi-conv", income_date: "2026-11-05", gross_amount: 5_000 }),
    ];
    fixtures.streams = [
      stream({ id: "s-nov", start_date: "2026-11-20", paycheck_amount: 39_090 }),
      stream({ id: "s-conv", start_date: "2026-11-05", paycheck_amount: 5_000 }),
    ];
    fixtures.plannerConversions = [
      {
        stream_id: "s-conv",
        bonus_event_id: null,
        occurrence_date: "2026-11-05",
        status: "converted",
        income_entry_id: "ie-conv",
        transaction_id: null,
      },
    ];

    await renderDashboard();
    const { months } = monthlyCard();

    expect(month(months, 10)).toEqual({ actual: 12_813, planned: 39_090 });
  });

  it("counts income months by their local calendar month", async () => {
    fixtures.personal = [
      personal({ id: "pi-jan", income_date: "2026-01-01", gross_amount: 1_000 }),
      personal({ id: "pi-nov", income_date: "2026-11-01", gross_amount: 7_813 }),
    ];

    await renderDashboard();
    const fs = screen.getByTestId("financial-score");

    // January and November — under UTC parsing Jan 1 dropped out of the year
    // and Nov 1 was counted as October.
    expect(Number(fs.getAttribute("data-months-with-income"))).toBe(2);
    expect(Number(fs.getAttribute("data-months-elapsed"))).toBe(11);
  });
});
