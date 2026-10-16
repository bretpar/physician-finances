import { describe, it, expect } from "vitest";
import { getProjectedTotals, type ProjectedPaycheck, type ProjectedIncomeStream } from "@/hooks/useProjectedIncome";
import { computeUnifiedTaxEstimate, type UnifiedTaxInput } from "@/lib/taxCalculationService";
import { sumEligiblePlannedBusinessExpenses } from "@/hooks/useTaxEstimate";

/* ─── Fixtures ─── */

const stream = (over: Partial<ProjectedIncomeStream>): ProjectedIncomeStream =>
  ({
    id: "s1",
    user_id: "u",
    organization_id: null,
    company: "Co",
    company_type: "w2",
    pay_frequency: "monthly",
    custom_interval_days: null,
    start_date: "2026-01-01",
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
    created_at: "",
    updated_at: "",
    ...over,
  }) as ProjectedIncomeStream;

const paycheck = (over: Partial<ProjectedPaycheck>): ProjectedPaycheck =>
  ({
    date: "2026-06-01",
    grossAmount: 0,
    taxesWithheld: 0,
    retirement401k: 0,
    preTaxDeductions: 0,
    healthcareDeduction: 0,
    hsaContribution: 0,
    netAmount: 0,
    type: "paycheck",
    label: "p",
    streamId: "s1",
    matchStatus: "active",
    ...over,
  }) as ProjectedPaycheck;

// Reviewed scenario: $500 × 5 planned VA (W-2) premiums = $2,500; $8,904 planned
// W-2 employee retirement; $870 planned business retirement; $12,880 planned
// business receipts. Amounts come from the fixture, not hardcoded into the app.
const vaStream = stream({ id: "va", company: "VA", company_type: "w2", source_id: "co-va" });
const vituityStream = stream({
  id: "vit",
  company: "Vituity",
  company_type: "1099_schedule_c",
  source_id: "co-vit",
});

const vaPaychecks = Array.from({ length: 5 }, (_, i) =>
  paycheck({
    streamId: "va",
    date: `2026-0${i + 6}-01`,
    grossAmount: 5000,
    healthcareDeduction: 500,
    retirement401k: 8904 / 5,
  }),
);
const vitPaycheck = paycheck({
  streamId: "vit",
  grossAmount: 12880,
  retirement401k: 870,
  employerRetirementContribution: 0,
});

describe("projected source classification (W-2 vs business)", () => {
  it("W-2 payroll premiums never enter the self-employed health-insurance deduction", () => {
    const t = getProjectedTotals([...vaPaychecks, vitPaycheck], [vaStream, vituityStream]);
    expect(t.healthInsuranceDeduction).toBe(0);
    // A planned SE/K-1 premium is preserved.
    const seStream = stream({ id: "se", company_type: "k1_partnership", source_id: "co-se" });
    const sePay = paycheck({ streamId: "se", grossAmount: 4000, healthcareDeduction: 1200 });
    const t2 = getProjectedTotals([sePay], [seStream]);
    expect(t2.healthInsuranceDeduction).toBe(1200);
  });

  it("QBI retirement slice excludes W-2 deferrals but keeps business retirement", () => {
    const t = getProjectedTotals([...vaPaychecks, vitPaycheck], [vaStream, vituityStream]);
    // Full retirement total (AGI path) still includes everything.
    expect(t.retirement401k).toBeCloseTo(8904 + 870, 2);
    // QBI slice = business-only.
    expect(t.retirement401kSe).toBeCloseTo(870, 2);
  });

  it("forecast business gross is keyed by company for state-tax eligibility", () => {
    const t = getProjectedTotals([...vaPaychecks, vitPaycheck], [vaStream, vituityStream]);
    expect(t.forecastBusinessGrossByCompany["co-vit"]).toBe(12880);
    expect(t.forecastBusinessGrossByCompany["co-va"]).toBeUndefined();
  });

  it("eligible planned business gross sums only for eligible companies", () => {
    const byCompany = { "co-vit": 12880, "co-va": 25000 };
    const companies = [
      { id: "co-vit", name: "Vituity", companyType: "1099_schedule_c", applyBusinessStateTax: true },
      { id: "co-va", name: "VA", companyType: "w2", applyBusinessStateTax: true },
    ];
    expect(sumEligiblePlannedBusinessExpenses(byCompany, companies as any, {} as any)).toBe(12880);
    // Company toggle off → excluded.
    const off = [
      { id: "co-vit", name: "Vituity", companyType: "1099_schedule_c", applyBusinessStateTax: false },
      { id: "co-va", name: "VA", companyType: "w2", applyBusinessStateTax: true },
    ];
    expect(sumEligiblePlannedBusinessExpenses(byCompany, off as any, {} as any)).toBe(0);
  });
});

/* ─── Engine-level: QBI attribution and forecast state tax ─── */

const baseInput: UnifiedTaxInput = {
  businessIncome: 100000,
  seEligibleBusinessIncome: 100000,
  businessW2: 0,
  businessFederalWithheld: 0,
  businessStateWithheld: 0,
  businessPreTax: 0,
  businessRetirement: 9774, // blended actual+planned-style total (regression guard)
  ownerHealthcare: 0,
  businessStateEligibleGross: 100000,
  businessStateEligibleExpenses: 0,
  businessStateEligibleMileage: 0,
  businessStateEligibleOwnerAdjustments: 0,
  personalIncome: 80000,
  personalW2: 80000,
  personalNonW2Income: 0,
  personalFederalWithheld: 12000,
  personalStateWithheld: 0,
  personalPreTax: 0,
  personalRetirement: 0,
  netStockGain: 0,
  businessExpenses: 0,
  mileageDeduction: 0,
  annualizedRetirement: 0,
  txActualWithholding: 0,
  actualEstimatedPaymentsMade: 0,
  taxSavingsSetAside: 0,
  remainingPayPeriods: 6,
  projectedW2Income: 0,
  projectedSEIncome: 0,
  projectedOtherIncome: 0,
  projectedFederalWithheld: 0,
  projectedStateWithheld: 0,
  projectedPreTax: 0,
  projectedRetirement: 0,
  projectedHealthInsuranceDeduction: 0,
  filingStatus: "married_filing_jointly",
  lastYearTax: 0,
  ssWageCap: 184500,
  includeProjectedIncome: true,
};

describe("QBI retirement attribution", () => {
  it("W-2 projected deferrals do not reduce business QBI when the SE slice is supplied", () => {
    // Same blended totals; only the QBI-scoped slice differs.
    const blended = computeUnifiedTaxEstimate({
      ...baseInput,
      projectedRetirement: 8904, // W-2 deferrals, no SE slice supplied (legacy behavior)
    }).debug;
    const scoped = computeUnifiedTaxEstimate({
      ...baseInput,
      businessRetirementQbi: 870,
      projectedRetirement: 8904,
      projectedSeRetirement: 0,
    }).debug;
    // Scoping W-2 deferrals out of QBI must raise (or hold) the QBI deduction…
    expect(scoped.qbiDeduction).toBeGreaterThanOrEqual(blended.qbiDeduction);
    // …while AGI treatment of retirement is preserved (combined401k unchanged).
    expect(scoped.agi).toBe(blended.agi);
  });
});

describe("forecast business state tax attribution", () => {
  const stateCfg = {
    businessStateTaxEnabled: true,
    businessStateTaxRate: 1.5,
    businessStateTaxBase: "net_profit" as const,
  };

  it("eligible planned receipts add to the state-tax base in forecast mode only", () => {
    const actual = computeUnifiedTaxEstimate({
      ...baseInput,
      ...stateCfg,
      includeProjectedIncome: false,
    }).debug;
    // Forecast: $12,880 eligible planned gross, no additional eligible expenses.
    const forecast = computeUnifiedTaxEstimate({
      ...baseInput,
      ...stateCfg,
      businessStateEligibleGross: 100000 + 12880,
      projectedSEIncome: 12880,
    }).debug;
    expect(forecast.businessStateTax - actual.businessStateTax).toBeCloseTo(12880 * 0.015, 2);
    // Actual Only is unaffected by future receipts.
    expect(actual.businessStateTax).toBeCloseTo(100000 * 0.015, 2);
  });
});
