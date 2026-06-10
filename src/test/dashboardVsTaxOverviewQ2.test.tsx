import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardQuarterlyPaymentCallout from "@/components/dashboard/QuarterlyPaymentCallout";
import QuarterlyTracker from "@/components/dashboard/QuarterlyTracker";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

/**
 * Integration test: Dashboard Q2 Payment card and Tax Overview Q2
 * Recommended quarterly payment must show the same dollar amount when
 * driven by identical inputs. Both views go through
 * `buildQuarterRecommendation` and read `recommendedPaymentToMake`, so a
 * future regression that diverges Dashboard vs Tax Overview math will
 * fail this test.
 */

const YEAR = 2026;
// Pick a date inside the Q2 due window (Jun 15 deadline). On Jun 9, 2026
// `getActivePaymentTarget` returns Q2, so the Dashboard callout renders
// and `currentOwningYear()` inside QuarterlyTracker also selects Q2.
const TODAY = new Date(2026, 5, 9, 12, 0, 0);

const annualTaxLiability = 60_000;

// Realistic inputs: a couple of W-2 paychecks (counts as Paid) and a
// business reserve (counts as Saved, does NOT reduce recommended payment).
const personalEntries = [
  { income_date: `${YEAR}-02-15`, gross_amount: 25_000, federal_withholding: 2_300 },
  { income_date: `${YEAR}-05-15`, gross_amount: 25_000, federal_withholding: 2_300 },
];
const incomeEntries = [
  { income_date: `${YEAR}-05-20`, amount: 10_000, additional_tax_reserve: 3_000 },
];
const payments: any[] = [];

const sharedInput = {
  annualTaxLiability,
  personalEntries,
  incomeEntries,
  transactions: [],
  payments,
  now: TODAY,
};

describe("Dashboard Q2 Payment vs Tax Overview Q2 Recommended quarterly payment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the same dollar amount in both views", () => {
    // Sanity-check the canonical helper directly so the expected number is
    // pinned in the test independent of either component.
    const expected = buildQuarterRecommendation({
      ...sharedInput,
      year: YEAR,
      quarter: 2,
    });
    expect(expected.quarterLabel).toBe("Q2");
    expect(expected.recommendedPaymentToMake).toBeGreaterThan(0);

    const fmt = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);
    const expectedText = fmt(expected.recommendedPaymentToMake);

    // ── Dashboard callout ───────────────────────────────────────────────
    const { unmount: unmountDashboard } = render(
      <MemoryRouter>
        <DashboardQuarterlyPaymentCallout {...sharedInput} />
      </MemoryRouter>,
    );
    // Header confirms we are looking at the Q2 callout.
    expect(screen.getAllByText(/Q2 Payment/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Due Jun 15/i)).toBeInTheDocument();
    const dashboardAmount = screen.getByText(expectedText);
    expect(dashboardAmount).toBeInTheDocument();
    unmountDashboard();

    // ── Tax Overview tracker (showRecommendedPayment header card) ──────
    render(
      <MemoryRouter>
        <QuarterlyTracker
          annualTaxLiability={annualTaxLiability}
          payments={payments}
          incomeEntries={incomeEntries}
          personalEntries={personalEntries}
          transactions={[]}
          companies={[]}
          showRecommendedPayment
          showCompanyBreakdown={false}
          showFooter={false}
          showQuarterNavigation={false}
        />
      </MemoryRouter>,
    );

    // Scope the assertion to the "Recommended quarterly payment" card so
    // we don't accidentally match another dollar amount on the page.
    const recommendedLabel = screen.getByText(/Recommended quarterly payment/i);
    const recommendedCard = recommendedLabel.closest("div")!.parentElement!;
    const overviewAmount = within(recommendedCard).getByText(expectedText);
    expect(overviewAmount).toBeInTheDocument();

    // Final guarantee: same string in both views.
    expect(overviewAmount.textContent).toBe(dashboardAmount.textContent);
  });
});
