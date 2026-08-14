import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import QuarterlyTracker from "@/components/dashboard/QuarterlyTracker";

const YEAR = 2026;
const TODAY = new Date(2026, 5, 9, 12, 0, 0); // inside Q2 due window

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function renderTracker(props: Partial<React.ComponentProps<typeof QuarterlyTracker>> = {}) {
  return render(
    <MemoryRouter>
      <QuarterlyTracker
        annualTaxLiability={60_000}
        federalIncomeTax={48_000}
        selfEmploymentTax={12_000}
        payments={[]}
        incomeEntries={[]}
        personalEntries={[]}
        transactions={[]}
        companies={[]}
        showRecommendedPayment
        showCompanyBreakdown={false}
        showFooter={false}
        showQuarterNavigation={false}
        initialView={{ year: YEAR, quarter: 2 }}
        {...props}
      />
    </MemoryRouter>,
  );
}

async function expandDetails() {
  const trigger = screen.getByText("Quarterly payment details");
  await userEvent.click(trigger);
  await waitFor(() => expect(screen.getByText(/tax target/i)).toBeInTheDocument());
}

describe("QuarterlyTracker simplified UI breakdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'Covered so far' instead of 'Paid + Saved'", () => {
    renderTracker();
    expect(screen.getByText(/Covered so far/i)).toBeInTheDocument();
    expect(screen.queryByText(/Paid \+ Saved/i)).not.toBeInTheDocument();
  });

  it("shows 'Q2 tax target' with federal/SE breakdown when tax estimate provides split", async () => {
    renderTracker();
    await expandDetails();
    const target = screen.getByText(/Q2 tax target/i).closest("div")!;
    expect(within(target).getByText(fmt(15_000))).toBeInTheDocument(); // 60k/4
    expect(screen.getByText(/Federal income tax/i)).toBeInTheDocument();
    expect(screen.getByText(/Self-employment tax/i)).toBeInTheDocument();
  });

  it("shows covered sub-items: W-2 withholding, estimated payments, and savings", async () => {
    renderTracker({
      personalEntries: [
        { income_date: `${YEAR}-05-15`, gross_amount: 20_000, federal_withholding: 2_000, income_type: "w2" },
      ],
      payments: [
        { payment_date: `${YEAR}-05-20`, amount: 1_500, applied_quarter: "Q2", applied_tax_year: YEAR, quarter: "Q2" } as any,
      ],
      incomeEntries: [
        { income_date: `${YEAR}-05-10`, amount: 10_000, additional_tax_reserve: 1_000 },
      ],
    });
    await expandDetails();
    expect(screen.getByText("Quarterly payment details")).toBeInTheDocument();
    expect(screen.getByText(/W-2 federal withholding/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated tax payments/i)).toBeInTheDocument();
    expect(screen.getByText(/Tax savings set aside/i)).toBeInTheDocument();
  });

  it("shows informational 'Payroll taxes already handled' section for W-2 SS/Medicare", async () => {
    renderTracker({
      personalEntries: [
        {
          income_date: `${YEAR}-05-15`,
          gross_amount: 20_000,
          federal_withholding: 2_000,
          ss_withholding: 1_200,
          medicare_withholding: 300,
          income_type: "w2",
        },
      ],
    });
    await expandDetails();
    expect(screen.getByText(/Payroll taxes already handled/i)).toBeInTheDocument();
    expect(screen.getByText(/Social Security withheld/i)).toBeInTheDocument();
    expect(screen.getByText(/Medicare withheld/i)).toBeInTheDocument();
    expect(screen.getByText(fmt(1_200))).toBeInTheDocument();
    expect(screen.getByText(fmt(300))).toBeInTheDocument();
  });

  it("hides payroll tax section when no W-2 SS/Medicare was withheld", () => {
    renderTracker({
      personalEntries: [
        { income_date: `${YEAR}-05-15`, gross_amount: 20_000, federal_withholding: 2_000, income_type: "w2" },
      ],
    });
    expect(screen.queryByText(/Payroll taxes already handled/i)).not.toBeInTheDocument();
  });

  it("hides federal/SE target breakdown when tax estimate has no split", async () => {
    renderTracker({ federalIncomeTax: 0, selfEmploymentTax: 0 });
    await expandDetails();
    expect(screen.getByText(/Q2 tax target/i)).toBeInTheDocument();
    expect(screen.queryByText(/Federal income tax/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Self-employment tax/i)).not.toBeInTheDocument();
  });
});
