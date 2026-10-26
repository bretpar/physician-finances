import { describe, it, expect } from "vitest";
import { generateProjectedPaychecks, type ProjectedIncomeStream } from "@/hooks/useProjectedIncome";
import { closureWindowForYear, openSegments, type ClosureLookup } from "@/lib/companyClosure";
import { computeSavedW2CompanyProjectionAddon } from "@/lib/savedW2CompanyProjection";

const Y = new Date().getFullYear();

function stream(o: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s1", company: "Acme", company_type: "w2", pay_frequency: "monthly",
    start_date: `${Y}-01-15`, end_date: null, paycheck_amount: 1000, taxes_withheld: 100,
    retirement_401k: 0, pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0,
    state_withholding: 0, federal_withholding: 0, ss_withholding: 0, medicare_withholding: 0,
    additional_tax_reserve: 0, is_active: true, include_in_tax: true, notes: "",
    custom_interval_days: null, source_id: "co1", ...o,
  } as ProjectedIncomeStream;
}

const lookup = (reopenedOn: string | null): ClosureLookup => ({
  periods: [{ id: "p", companyId: "co1", closedOn: `${Y}-04-01`, reopenedOn }],
  companies: [{ id: "co1", name: "Acme" }],
});

const dates = (l?: ClosureLookup) =>
  generateProjectedPaychecks([stream()], [], [], [], [], [], undefined, l).map((p) => p.date);

describe("company closure — planner occurrences", () => {
  it("without closures the schedule is unchanged (12 monthly paychecks)", () => {
    expect(dates()).toHaveLength(12);
  });

  it("closed Apr 1 and never reopened → only Jan–Mar remain", () => {
    expect(dates(lookup(null))).toEqual([`${Y}-01-15`, `${Y}-02-15`, `${Y}-03-15`]);
  });

  it("reopened Jul 1 → resumes on the original schedule with no catch-up paychecks", () => {
    const d = dates(lookup(`${Y}-07-01`));
    expect(d).toHaveLength(9);
    expect(d).not.toContain(`${Y}-04-15`);
    expect(d).not.toContain(`${Y}-06-15`);
    expect(d).toContain(`${Y}-07-15`);
  });

  it("an already-converted closed-period occurrence stays as history", () => {
    const p = generateProjectedPaychecks([stream()], [], [], [],
      [{ stream_id: "s1", bonus_event_id: null, occurrence_date: `${Y}-05-15`, status: "converted" } as any],
      [], undefined, lookup(null));
    expect(p.map((x) => x.date)).toContain(`${Y}-05-15`);
  });

  it("streams of other companies are untouched", () => {
    const p = generateProjectedPaychecks([stream({ id: "s2", source_id: "co2", company: "Other" })], [], [], [], [], [], undefined, lookup(null));
    expect(p).toHaveLength(12);
  });
});

describe("company closure — annual targets", () => {
  it("open segments skip each closed interval", () => {
    expect(openSegments(lookup(`${Y}-07-01`).periods, "co1", `${Y}-01-01`, `${Y}-12-31`)).toEqual([
      { start: `${Y}-01-01`, end: `${Y}-03-31` },
      { start: `${Y}-07-01`, end: `${Y}-12-31` },
    ]);
  });

  it("saved annual salary never refills closed months after reopening", () => {
    // $120k target, $30k earned Jan–Mar, closed Apr–Jun, today = Jul 1.
    const win = closureWindowForYear(lookup(`${Y}-07-01`).periods, "co1", `${Y}-07-01`, Y);
    const addon = computeSavedW2CompanyProjectionAddon({
      companies: [{ id: "co1", name: "Acme", companyType: "w2", payFrequency: "monthly", projectedAnnualGross: 120000, expectedFederalWithholdingPerPaycheck: null }],
      coveredCompanyIds: new Set(),
      ytdGrossByCompanyKey: new Map([["acme", 30000]]),
      remainingPaychecksFor: () => 6,
      closureWindowFor: () => win,
    });
    // Without closure the addon would be $90,000; the pace cap is ~half a year.
    expect(addon.futureGross).toBeLessThan(61000);
    expect(addon.futureGross).toBeGreaterThan(59000);
  });
});
