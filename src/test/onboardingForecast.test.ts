import { afterAll, describe, expect, it } from "vitest";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";
import { buildOnboardingForecast, onboardingYtdBaseline } from "@/lib/onboardingForecast";
import { buildOnboardingIncomePlan } from "@/lib/onboardingIncomePlan";
import { generateProjectedPaychecks, buildProjectedIncomeStreamInsert, type ProjectedIncomeStream } from "@/hooks/useProjectedIncome";
import { vi } from "vitest";

const company = { id: "co", name: "Employer", companyType: "w2", projectedAnnualGross: 120000,
  advancedFieldVisibility: { onboarding_income_plan: { taxYear: 2026, annual: 120000, ytdEntered: null,
    originalPlan: { streamId: "plan", startDate: "2026-10-26", historicalGross: 90000 } } } };
const stream = { ...buildProjectedIncomeStreamInsert({ source_id: "co", company: "Employer", start_date: "2026-10-26", end_date: "2026-12-31", pay_frequency: "monthly", paycheck_amount: 10000 }, "user", null),
  id: "plan", created_at: "2026-10-26T11:00:00Z", updated_at: "2026-10-26T11:00:00Z" } as ProjectedIncomeStream;

function forecast(recorded: number, planned: number, historical = 90000) {
  const streams = [{ ...stream, paycheck_amount: planned / 3 }];
  return buildOnboardingForecast({ companies: [{ ...company, advancedFieldVisibility: { onboarding_income_plan: {
    taxYear: 2026, annual: 120000, ytdEntered: historical === 100000 ? 100000 : null,
    originalPlan: { streamId: "plan", startDate: "2026-10-26", historicalGross: historical },
  } } }], streams, paychecks: generateProjectedPaychecks(streams, []), taxYear: 2026,
    countedIncome: recorded ? [{ source_id: "co", date: "2026-09-01", gross: recorded }] : [], catchups: [] })[0];
}

describe("shared onboarding forecast inputs", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00"));
  afterAll(() => vi.useRealTimers());
  it.each([[0, 30000, 90000], [10000, 30000, 80000], [90000, 30000, 0]])(
    "%i actual plus %i planned replaces history with %i", (actual, planned, history) => {
      const row = forecast(actual, planned);
      expect(row.historical).toBe(history);
      expect(row.total).toBe(120000);
    });
  it("preserves simplified $100k YTD with $20k remaining", () => {
    const row = forecast(0, 20000, 100000);
    expect(row.historical).toBe(100000);
    expect(row.total).toBe(120000);
  });
  it("detailed YTD wins over simplified YTD without stacking", () => {
    const ytd = onboardingYtdBaseline(90000, [100000, 80000]);
    expect(ytd).toBe(100000);
    const plan = buildOnboardingIncomePlan({ annual: 120000, ytd, payFrequency: "monthly", today: "2026-10-26" });
    expect(plan?.plannedRemaining).toBeCloseTo(20000, 1);
    const row = forecast(100000, 20000, 100000);
    expect(row.historical).toBe(0);
    expect(row.total).toBe(120000);
  });
  it("reduced pay stays reduced rather than becoming history", () => {
    expect(forecast(0, 15000).total).toBe(105000);
  });
  it.each([{ streams: [] }, { streams: [{ ...stream, is_active: false }] }, { streams: [{ ...stream, end_date: "2026-10-25" }] }])(
    "deleted, inactive and stopped plans keep only original history", ({ streams }) => {
      const rows = buildOnboardingForecast({ companies: [company], streams, paychecks: generateProjectedPaychecks(streams, []), countedIncome: [], catchups: [], taxYear: 2026 });
      expect(rows[0].historical).toBe(90000);
      expect(rows[0].total).toBe(90000);
    });
  it("uses exact counted catch-up residual and source IDs", () => {
    const rows = buildOnboardingForecast({ companies: [company], streams: [stream], paychecks: generateProjectedPaychecks([stream], []), taxYear: 2026,
      countedIncome: [{ source_id: "co", date: "2026-09-01", gross: 10000 }, { source_id: "other", company: "Employer", date: "2026-09-01", gross: 50000 }],
      catchups: [{ companyId: "co", date: "2026-09-30", gross: 80000 }] });
    expect(rows[0].recorded).toBe(90000);
    expect(rows[0].historical).toBe(0);
    expect(rows[0].total).toBe(120000);
  });
  it("converted future income replaces planned income, not historical income", () => {
    const paychecks = generateProjectedPaychecks([stream], []);
    paychecks[0].matchStatus = "converted";
    const rows = buildOnboardingForecast({ companies: [company], streams: [stream], paychecks, taxYear: 2026,
      countedIncome: [{ source_id: "co", date: "2026-10-26", gross: 10000 }], catchups: [] });
    expect(rows[0].historical).toBe(90000);
    expect(rows[0].total).toBe(120000);
  });
  it("supplies $120k to the real annual calculator without fictional withholding", () => {
    const row = forecast(0, 30000);
    const input: UnifiedTaxInput = {
      businessIncome: 0, seEligibleBusinessIncome: 0, businessW2: 0, businessFederalWithheld: 0,
      businessStateWithheld: 0, businessPreTax: 0, businessRetirement: 0, ownerHealthcare: 0,
      businessStateEligibleGross: 0, businessStateEligibleExpenses: 0, businessStateEligibleMileage: 0,
      businessStateEligibleOwnerAdjustments: 0, personalIncome: 0, personalW2: 0, personalNonW2Income: 0,
      personalFederalWithheld: 0, personalStateWithheld: 0, personalPreTax: 0, personalRetirement: 0,
      netStockGain: 0, businessExpenses: 0, mileageDeduction: 0, annualizedRetirement: 0,
      txActualWithholding: 0, actualEstimatedPaymentsMade: 0, taxSavingsSetAside: 0, remainingPayPeriods: 3,
      projectedW2Income: row.planned + row.historical, projectedSEIncome: 0, projectedOtherIncome: 0,
      projectedFederalWithheld: 0, projectedStateWithheld: 0, projectedPreTax: 0, projectedRetirement: 0,
      projectedHealthInsuranceDeduction: 0, filingStatus: "single", includeProjectedIncome: true,
    };
    const result = computeUnifiedTaxEstimate(input);
    expect(result.debug.totalGrossIncome).toBe(120000);
    expect(result.debug.countedCreditsTotal).toBe(0);
    expect(result.debug.totalEstimatedTax).toBeGreaterThan(computeUnifiedTaxEstimate({ ...input, projectedW2Income: 30000 }).debug.totalEstimatedTax);
    expect(computeUnifiedTaxEstimate({ ...input, includeProjectedIncome: false }).debug.totalGrossIncome).toBe(0);
  });
});