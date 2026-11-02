import { describe, expect, it } from "vitest";
import { annualizeContributionAmount } from "@/hooks/useRetirementContributions";
import { countContributionOccurrences } from "@/lib/retirementOpportunityEngine";
import { isClosedOn, type ClosurePeriod } from "@/lib/companyClosure";

const periods: ClosurePeriod[] = [
  { id: "apr", companyId: "co", closedOn: "2026-04-01", reopenedOn: "2026-04-20" },
  { id: "jul", companyId: "co", closedOn: "2026-07-01", reopenedOn: "2026-07-20" },
];
const contribution = {
  contribution_amount: 800, frequency: "monthly", start_date: "2026-01-15",
  end_date: "2026-12-31", contribution_date: "2026-01-15", contribution_type: "employer",
};
const opts = { taxYear: 2026, companyId: "co", closurePeriods: periods };
describe("retirement recurrence keeps the saved anchor across closures", () => {
  it("$800 monthly on January 15 skips April and July: ten occurrences, $8,000", () => {
    expect(annualizeContributionAmount(contribution, opts)).toMatchObject({ occurrences: 10, annual: 8000, perPaycheck: 800 });
    const dates: string[] = [];
    countContributionOccurrences({ taxYear: 2026, payFrequency: "monthly", startDate: contribution.start_date,
      isEligibleDate: (date) => { if (isClosedOn(periods, "co", date)) return false; dates.push(date); return true; },
    });
    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-05-15", "2026-06-15", "2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15"]);
  });
  it("repeated and overlapping closure periods cannot duplicate contributions or mutate saved records", () => {
    const history = { ...contribution, frequency: "one_time", contribution_date: "2026-04-15" };
    const before = structuredClone({ contribution, history, periods });
    const repeated = { ...opts, closurePeriods: [...periods, periods[0]] };
    expect(annualizeContributionAmount(contribution, repeated).annual).toBe(8000);
    expect(annualizeContributionAmount(contribution, repeated).annual).toBe(8000);
    expect(annualizeContributionAmount(history, repeated).annual).toBe(800);
    expect({ contribution, history, periods }).toEqual(before);
  });
  it("other companies and schedules with no closures keep their existing totals", () => {
    expect(annualizeContributionAmount(contribution, { ...opts, companyId: "other" }).annual).toBe(9600);
    expect(annualizeContributionAmount(contribution, { taxYear: 2026 }).annual).toBe(9600);
  });
  it("per-paycheck and yearly recurrences filter dates without restarting their cadence", () => {
    expect(annualizeContributionAmount({ ...contribution, frequency: "per_paycheck" }, { ...opts, payFrequency: "monthly" }).annual).toBe(8000);
    expect(annualizeContributionAmount({ ...contribution, frequency: "yearly", start_date: "2026-04-15" }, opts).annual).toBe(0);
  });
});