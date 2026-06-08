import { describe, it, expect } from "vitest";
import {
  aggregatePlannedBusinessExpenses,
  resolvePlannedStreamCompanyId,
  type PlannedExpenseStreamLite,
  type PlannedExpensePaycheckLite,
  type CompanyLite,
} from "@/lib/plannedBusinessExpenses";
import {
  generateProjectedPaychecks,
  getProjectedTotals,
  type ProjectedIncomeStream,
} from "@/hooks/useProjectedIncome";

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
    const stream = k1Stream();
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
