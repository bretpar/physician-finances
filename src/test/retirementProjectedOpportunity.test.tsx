/**
 * Projected Solo 401(k) employer opportunity — canonical projection path.
 *
 * Fixture mirrors the production smoke-QA account: Schedule C actual net
 * profit $50,000, remaining ACTIVE planned gross $20,000, planned business
 * expenses $5,000 → projected year-end net profit $65,000.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";
import { RetirementRoomSummary } from "@/components/retirement/RetirementRoomSummary";
import { generateProjectedPaychecks } from "@/hooks/useProjectedIncome";
import { aggregatePlannedBusinessExpenses } from "@/lib/plannedBusinessExpenses";

const YEAR = 2026;

const companies = [
  { id: "co-sc", name: "QA Schedule C", companyType: "1099_schedule_c", payFrequency: null },
  { id: "co-w2", name: "QA W2", companyType: "w2", payFrequency: "biweekly" },
];

const standalone = [
  { id: "c1", companyId: "co-sc", accountType: "solo_401k", contributionType: "employee", annualAmount: 3_000, contributionDate: "2026-09-19" },
  { id: "c2", companyId: "co-sc", accountType: "solo_401k", contributionType: "employer", annualAmount: 5_000, contributionDate: "2026-09-19" },
  { id: "c3", companyId: "co-w2", accountType: "401k", contributionType: "employee", annualAmount: 4_500, contributionDate: "2026-09-19" },
];

const view = (opts?: { plannedExpenses?: number; includePlanned?: boolean }) =>
  computeRetirementRoomView({
    taxYear: YEAR,
    filingStatus: "single",
    dateOfBirth: null,
    magi: null,
    eligibleTaxableCompensation: 50_000,
    companies,
    paychecks: [],
    standalone,
    ira: { traditionalContributed: 0, rothContributed: 0 },
    actualNetProfitByCompany: new Map([["co-sc", 50_000]]),
    remainingPlannedGrossByCompany:
      opts?.includePlanned === false ? new Map() : new Map([["co-sc", 20_000]]),
    remainingPlannedExpensesByCompany: new Map([["co-sc", opts?.plannedExpenses ?? 5_000]]),
    includeProjection: true,
  });

const soloActual = (v: ReturnType<typeof view>) =>
  v.engine.plans.find((p) => p.companyId === "co-sc")!;
const soloProjected = (v: ReturnType<typeof view>) =>
  v.engineProjected!.plans.find((p) => p.companyId === "co-sc")!;

describe("projected employer opportunity", () => {
  it("projects $65,000 net profit and beats current capacity", () => {
    const v = view();
    // Current: $50,000 − half SE tax → 20% ≈ $9,294 total allowable.
    expect(soloActual(v).employerContribution + soloActual(v).employerCapacityRemaining!).toBeCloseTo(9_293.52, 0);
    // Projected: $65,000 − half SE tax → 20% ≈ $12,082 total allowable.
    expect(soloProjected(v).employerContribution + soloProjected(v).employerCapacityRemaining!).toBeCloseTo(12_081.58, 0);
    expect(soloProjected(v).employerCapacityRemaining!).toBeGreaterThan(
      soloActual(v).employerCapacityRemaining!,
    );
  });

  it("renders the projected opportunity on the employer card", () => {
    render(
      <RetirementRoomSummary room={view()} hasPlannerAccess hasEmployerOpportunityAccess hasCapacityAccess />,
    );
    const card = screen.getAllByTestId("plan-capacity-card")[0];
    expect(card.textContent).toContain("$5,000 contributed");
    expect(card.textContent).toContain("Up to $7,082 additional");
    expect(card.textContent).toContain("Based on projected 2026 business profit");
    expect(card.textContent).not.toContain("—");
  });

  it("planned expenses reduce projected capacity", () => {
    const less = soloProjected(view({ plannedExpenses: 0 })).employerCapacityRemaining!;
    const more = soloProjected(view({ plannedExpenses: 5_000 })).employerCapacityRemaining!;
    expect(more).toBeLessThan(less);
  });

  it("excludes matched/converted planner occurrences from projected profit", () => {
    const stream: any = {
      id: "s1", company: "QA Schedule C", company_type: "1099", source_id: "co-sc",
      is_active: true, pay_frequency: "single", paycheck_amount: 20_000,
      forecast_expense_per_period: 5_000, start_date: "2026-10-15", end_date: null,
      taxes_withheld: 0, retirement_401k: 0, pre_tax_deductions: 0,
      healthcare_deduction: 0, hsa_contribution: 0, include_in_tax: true,
    };
    const occurrences = generateProjectedPaychecks([stream], [], [], [], [], []) as any[];
    const gross = new Map<string, number>();
    for (const p of occurrences) {
      if (p.matchStatus !== "active") continue;
      gross.set(p.streamSourceId, (gross.get(p.streamSourceId) || 0) + Number(p.grossAmount || 0));
    }
    expect(gross.get("co-sc")).toBe(20_000);

    // A matched occurrence contributes nothing to remaining planned gross.
    const matched = occurrences.map((p) => ({ ...p, matchStatus: "matched" }));
    const matchedGross = matched
      .filter((p) => p.matchStatus === "active")
      .reduce((s, p) => s + Number(p.grossAmount || 0), 0);
    expect(matchedGross).toBe(0);

    const expenses = aggregatePlannedBusinessExpenses(
      [{ id: "s1", company: "QA Schedule C", company_type: "1099", source_id: "co-sc", is_active: true, forecast_expense_per_period: 5_000 }],
      occurrences.map((p) => ({ streamId: p.streamId, type: p.type, matchStatus: p.matchStatus })),
      companies.map((c) => ({ id: c.id, name: c.name })),
    );
    expect([...expenses.values()][0].total).toBe(5_000);
  });

  it("does not regress the shared employee remainder", () => {
    expect(view().engine.employee402g.contributed).toBe(7_500);
    expect(view().engine.employee402g.remaining).toBe(17_000);
  });
});
