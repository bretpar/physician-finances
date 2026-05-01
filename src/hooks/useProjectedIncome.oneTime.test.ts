import { describe, it, expect } from "vitest";
import { generateProjectedPaychecks, isStreamExpired, type ProjectedIncomeStream } from "./useProjectedIncome";
import { format, subDays, addDays } from "date-fns";

function makeStream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s1",
    company: "Acme",
    company_type: "w2",
    pay_frequency: "single",
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: null,
    paycheck_amount: 1000,
    taxes_withheld: 100,
    retirement_401k: 0,
    pre_tax_deductions: 0,
    healthcare_deduction: 0,
    hsa_contribution: 0,
    state_withholding: 0,
    federal_withholding: 0,
    ss_withholding: 0,
    medicare_withholding: 0,
    additional_tax_reserve: 0,
    is_active: true,
    include_in_tax: true,
    notes: "",
    custom_interval_days: null,
    ...overrides,
  } as ProjectedIncomeStream;
}

describe("one-time projected income stream", () => {
  it("is not expired when dated today", () => {
    const s = makeStream({ start_date: format(new Date(), "yyyy-MM-dd") });
    expect(isStreamExpired(s)).toBe(false);
  });

  it("is NOT expired for past dates within current year (so it appears in ledger)", () => {
    const s = makeStream({ start_date: format(subDays(new Date(), 30), "yyyy-MM-dd") });
    expect(isStreamExpired(s)).toBe(false);
  });

  it("is expired when dated before this calendar year", () => {
    const s = makeStream({ start_date: `${new Date().getFullYear() - 1}-06-01` });
    expect(isStreamExpired(s)).toBe(true);
  });

  it("appears in generated paychecks for past date this year", () => {
    const s = makeStream({ start_date: format(subDays(new Date(), 14), "yyyy-MM-dd") });
    const paychecks = generateProjectedPaychecks([s], [], [], [], []);
    const match = paychecks.find((p) => p.streamId === "s1");
    expect(match).toBeDefined();
    expect(match?.grossAmount).toBe(1000);
  });

  it("appears in generated paychecks for future date this year", () => {
    const future = addDays(new Date(), 7);
    if (future.getFullYear() !== new Date().getFullYear()) return; // skip near year boundary
    const s = makeStream({ start_date: format(future, "yyyy-MM-dd") });
    const paychecks = generateProjectedPaychecks([s], [], [], [], []);
    expect(paychecks.find((p) => p.streamId === "s1")).toBeDefined();
  });
});
