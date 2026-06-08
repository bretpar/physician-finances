import { describe, it, expect } from "vitest";
import {
  aggregatePlannedBusinessExpenses,
  resolvePlannedStreamCompanyId,
  type PlannedExpenseStreamLite,
  type PlannedExpensePaycheckLite,
  type CompanyLite,
} from "@/lib/plannedBusinessExpenses";
import {
  buildProjectedIncomeStreamInsert,
  generateProjectedPaychecks,
  getProjectedTotals,
  type ProjectedIncomeStream,
} from "@/hooks/useProjectedIncome";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";

const NWO_COMPANY: CompanyLite = { id: "co-nwo", name: "Northwest Orthopedic Partners" };

function k1Stream(overrides: Partial<PlannedExpenseStreamLite> = {}): PlannedExpenseStreamLite {
  return {
    id: "stream-k1",
    company: "Northwest Orthopedic Partners",
    company_type: "k1_partnership",
    source_id: NWO_COMPANY.id,
    is_active: true,
    forecast_expense_per_period: 2000,
    ...overrides,
  };
}

function paycheck(streamId: string, status = "active"): PlannedExpensePaycheckLite {
  return { streamId, type: "paycheck", matchStatus: status };
}

describe("aggregatePlannedBusinessExpenses (Tax Breakdown helper)", () => {
  it("multiplies forecast_expense_per_period by active paycheck count for K-1 streams", () => {
    const stream = k1Stream({ company_type: "k1" });
    const paychecks = Array.from({ length: 6 }, () => paycheck(stream.id));
    const buckets = aggregatePlannedBusinessExpenses([stream], paychecks, [NWO_COMPANY]);
    expect(buckets.size).toBe(1);
    const bucket = buckets.get(NWO_COMPANY.id)!;
    expect(bucket.companyId).toBe(NWO_COMPANY.id);
    expect(bucket.companyName).toBe(NWO_COMPANY.name);
    expect(bucket.filingType).toBe("k1_partnership");
    // 6 months × $2,000 = $12,000 planned K-1 expense
    expect(bucket.total).toBe(12000);
  });

  it("falls back to company-name match when stream.source_id is missing", () => {
    const stream = k1Stream({ source_id: null });
    expect(resolvePlannedStreamCompanyId(stream, [NWO_COMPANY])).toBe(NWO_COMPANY.id);
    const paychecks = Array.from({ length: 3 }, () => paycheck(stream.id));
    const buckets = aggregatePlannedBusinessExpenses([stream], paychecks, [NWO_COMPANY]);
    expect(buckets.get(NWO_COMPANY.id)?.total).toBe(6000);
  });

  it("ignores non-business filing types (W-2, other)", () => {
    const w2 = k1Stream({ id: "s-w2", company_type: "W2", forecast_expense_per_period: 500 });
    const buckets = aggregatePlannedBusinessExpenses(
      [w2],
      [paycheck(w2.id), paycheck(w2.id)],
      [NWO_COMPANY],
    );
    expect(buckets.size).toBe(0);
  });

  it("ignores inactive streams and non-active paychecks", () => {
    const inactive = k1Stream({ id: "s-inactive", is_active: false });
    const stream = k1Stream();
    const buckets = aggregatePlannedBusinessExpenses(
      [inactive, stream],
      [
        paycheck(inactive.id),
        paycheck(stream.id, "matched"),
        paycheck(stream.id, "converted"),
        paycheck(stream.id, "active"),
      ],
      [NWO_COMPANY],
    );
    expect(buckets.get(NWO_COMPANY.id)?.total).toBe(2000); // only 1 active paycheck
  });

  it("returns 0 expense when forecast_expense_per_period is 0", () => {
    const stream = k1Stream({ forecast_expense_per_period: 0 });
    const buckets = aggregatePlannedBusinessExpenses(
      [stream],
      [paycheck(stream.id), paycheck(stream.id)],
      [NWO_COMPANY],
    );
    expect(buckets.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine path: getProjectedTotals must also surface forecast K-1 expenses so
// the unified tax engine subtracts them from include-planned SE income.
// ─────────────────────────────────────────────────────────────────────────────

function fullStream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  const today = new Date();
  const futureStart = `${today.getFullYear()}-${String(Math.min(12, today.getMonth() + 2)).padStart(2, "0")}-01`;
  return {
    id: "k1-stream-1",
    user_id: "u1",
    organization_id: null,
    company: "Northwest Orthopedic Partners",
    company_type: "k1_partnership",
    pay_frequency: "monthly",
    custom_interval_days: null,
    start_date: futureStart,
    end_date: `${today.getFullYear()}-12-31`,
    paycheck_amount: 10000,
    taxes_withheld: 0,
    retirement_401k: 0,
    pre_tax_deductions: 0,
    is_active: true,
    include_in_tax: true,
    source_id: NWO_COMPANY.id,
    ui_income_subtype: null,
    federal_withholding: 0,
    state_withholding: 0,
    ss_withholding: 0,
    medicare_withholding: 0,
    healthcare_deduction: 0,
    hsa_contribution: 0,
    additional_tax_reserve: 0,
    notes: "",
    forecast_expense_per_period: 2000,
    forecast_expense_notes: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("getProjectedTotals — K-1 forecast expenses feed the engine", () => {
  it("persists forecast_expense_per_period when saving a new planned K-1 stream", () => {
    const payload = buildProjectedIncomeStreamInsert(fullStream({ company_type: "k1" }), "user-1", "org-1");

    expect(payload.forecast_expense_per_period).toBe(2000);
    expect(payload.company_type).toBe("k1");
    expect(payload.source_id).toBe(NWO_COMPANY.id);
    // A planned expense assumption stays on the projected stream; it must not
    // create an actual Business Activity transaction/expense row by itself.
    expect(payload).not.toHaveProperty("transaction_type");
    expect(payload).not.toHaveProperty("amount");
  });

  it("sums forecast_expense_per_period across active K-1 paychecks (include-planned)", () => {
    const stream = fullStream();
    const paychecks = generateProjectedPaychecks([stream], [], [], [], [], []);
    const activeCount = paychecks.filter((p) => p.matchStatus === "active").length;
    expect(activeCount).toBeGreaterThan(0);
    const totals = getProjectedTotals(paychecks, [stream]);
    expect(totals.seIncome).toBe(activeCount * 10000);
    // Engine consumes this; planned K-1 net = gross − forecastBusinessExpenses
    expect(totals.forecastBusinessExpenses).toBe(activeCount * 2000);
  });

  it("contributes $0 forecast expenses when stream is not SE (W-2)", () => {
    const stream = fullStream({ company_type: "W2", id: "w2-stream" });
    const paychecks = generateProjectedPaychecks([stream], [], [], [], [], []);
    const totals = getProjectedTotals(paychecks, [stream]);
    expect(totals.forecastBusinessExpenses).toBe(0);
  });
});

const scenarioInput: UnifiedTaxInput = {
  businessIncome: 120000,
  seEligibleBusinessIncome: 120000,
  businessW2: 0,
  businessFederalWithheld: 0,
  businessStateWithheld: 0,
  businessPreTax: 0,
  businessRetirement: 0,
  ownerHealthcare: 0,
  businessStateEligibleGross: 120000,
  businessStateEligibleExpenses: 20000,
  businessStateEligibleMileage: 0,
  businessStateEligibleOwnerAdjustments: 0,
  personalIncome: 150000,
  personalW2: 150000,
  personalNonW2Income: 0,
  personalFederalWithheld: 28000,
  personalStateWithheld: 0,
  personalPreTax: 0,
  personalRetirement: 0,
  netStockGain: 0,
  businessExpenses: 20000,
  seEligibleBusinessExpenses: 20000,
  mileageDeduction: 0,
  annualizedRetirement: 0,
  txActualWithholding: 0,
  actualEstimatedPaymentsMade: 0,
  taxSavingsSetAside: 0,
  remainingPayPeriods: 6,
  projectedW2Income: 0,
  projectedSEIncome: 60000,
  projectedOtherIncome: 0,
  projectedFederalWithheld: 0,
  projectedStateWithheld: 0,
  projectedPreTax: 0,
  projectedRetirement: 0,
  projectedHealthInsuranceDeduction: 0,
  filingStatus: "single",
  lastYearTax: 0,
  ssWageCap: 168600,
  includeProjectedIncome: false,
};

describe("planned K-1 include-planned net profit regression", () => {
  it("keeps Actual Only unchanged at actual net K-1 profit", () => {
    const actual = computeUnifiedTaxEstimate({ ...scenarioInput, includeProjectedIncome: false }).debug;

    expect(actual.grossBusinessIncome).toBe(120000);
    expect(actual.businessExpenses).toBe(20000);
    expect(actual.netBusinessProfit).toBe(100000);
    expect(actual.projectedIncome).toBe(0);
  });

  it("uses planned net profit, not planned gross, for include-planned K-1/business profit", () => {
    const planned = computeUnifiedTaxEstimate({
      ...scenarioInput,
      includeProjectedIncome: true,
      businessExpenses: 32000,
      seEligibleBusinessExpenses: 32000,
      businessStateEligibleGross: 180000,
      businessStateEligibleExpenses: 32000,
    }).debug;

    expect(planned.projectedIncome).toBe(60000);
    expect(planned.grossBusinessIncome).toBe(180000);
    expect(planned.businessExpenses).toBe(32000);
    expect(planned.netBusinessProfit).toBe(148000);
    expect(planned.netBusinessProfit).not.toBe(160000);
    expect(planned.totalReturnIncomeBeforeAdjustments).toBe(298000);
  });

  it("reduces forecast SE-taxable K-1 income by planned active K-1 expenses", () => {
    const withPlannedExpenses = computeUnifiedTaxEstimate({
      ...scenarioInput,
      includeProjectedIncome: true,
      businessExpenses: 32000,
      seEligibleBusinessExpenses: 32000,
    }).estimate;
    expect(withPlannedExpenses.seTax.netSEIncome).toBe(148000);
  });

  it("keeps active/passive actual K-1 SE display behavior intact", () => {
    const actualMixedK1 = computeUnifiedTaxEstimate({
      ...scenarioInput,
      businessIncome: 200000, // active gross 120k + passive K-1 80k
      seEligibleBusinessIncome: 120000, // active/general partner only
      businessExpenses: 20000,
      seEligibleBusinessExpenses: 20000,
      projectedSEIncome: 0,
      includeProjectedIncome: false,
    });

    expect(actualMixedK1.estimate.seTax.netSEIncome).toBe(100000);
    expect(actualMixedK1.debug.grossBusinessIncome).toBe(200000);
    expect(actualMixedK1.debug.netBusinessProfit).toBe(180000);
    expect(actualMixedK1.debug.totalReturnIncomeBeforeAdjustments).toBe(330000);
    expect(actualMixedK1.debug.otherIncome).toBe(0);
  });
});
