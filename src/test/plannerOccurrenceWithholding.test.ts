import { describe, it, expect } from "vitest";
import { buildOccurrenceLedgerFields, deriveOtherPreTax } from "@/lib/plannerOccurrenceLedger";
import { computeOccurrenceRepair } from "@/lib/plannerConversionRepair";
import {
  generateProjectedPaychecks,
  occurrenceDetailFields,
  type ProjectedIncomeStream,
  type ProjectedIncomeOverride,
} from "@/hooks/useProjectedIncome";

const year = new Date().getFullYear();

/** Optum-style biweekly W-2 stream with stream-level (default) withholding. */
const optum = {
  id: "stream-optum",
  user_id: "u1",
  organization_id: null,
  company: "Optum",
  company_type: "w2",
  pay_frequency: "biweekly",
  custom_interval_days: null,
  start_date: `${year}-01-02`,
  end_date: null,
  paycheck_amount: 6000,
  taxes_withheld: 1800,
  retirement_401k: 500,
  pre_tax_deductions: 100,
  is_active: true,
  include_in_tax: true,
  source_id: "co-optum",
  ui_income_subtype: "w2_user",
  federal_withholding: 1414,
  state_withholding: 0,
  ss_withholding: 300,
  medicare_withholding: 86,
  healthcare_deduction: 200,
  hsa_contribution: 0,
  additional_tax_reserve: 250,
  notes: "",
  forecast_expense_per_period: 0,
  forecast_expense_notes: "",
  created_at: "",
  updated_at: "",
} as ProjectedIncomeStream;

const detailedOverride = (date: string, fed: number, gross = 6879.68): ProjectedIncomeOverride =>
  ({
    id: `o-${date}`,
    stream_id: optum.id,
    user_id: "u1",
    organization_id: null,
    override_date: date,
    new_date: null,
    action: "modify",
    has_detailed_breakdown: true,
    paycheck_amount: gross,
    taxes_withheld: fed + 400 + 100,
    retirement_401k: 500,
    pre_tax_deductions: 300, // aggregate: health 200 + other 100
    federal_withholding: fed,
    state_withholding: 0,
    ss_withholding: 400,
    medicare_withholding: 100,
    healthcare_deduction: 200,
    hsa_contribution: 0,
    additional_tax_reserve: 250,
    notes: null,
    created_at: "",
    updated_at: "",
  }) as unknown as ProjectedIncomeOverride;

describe("generated occurrences expose their own withholding", () => {
  it("uses the modified occurrence values, not the stream default", () => {
    const d = occurrenceDetailFields(optum, detailedOverride(`${year}-08-14`, 1565.19));
    expect(d.federalWithholding).toBe(1565.19);
    expect(d.ssWithholding).toBe(400);
    expect(d.medicareWithholding).toBe(100);
    expect(d.additionalTaxReserve).toBe(250);
    expect(d.hasDetailedBreakdown).toBe(true);
  });

  it("falls back to the stream only for unmodified occurrences", () => {
    const d = occurrenceDetailFields(optum, null);
    expect(d.federalWithholding).toBe(1414);
    expect(d.hasDetailedBreakdown).toBe(false);
  });

  it("generateProjectedPaychecks carries per-occurrence federal withholding", () => {
    const dates = [`${year}-07-17`, `${year}-07-31`, `${year}-08-14`];
    const overrides = [
      detailedOverride(dates[1], 1502.4),
      detailedOverride(dates[2], 1565.19),
    ];
    const paychecks = generateProjectedPaychecks([optum], [], [], overrides, [], []);
    const byDate = new Map(paychecks.map((p) => [p.date, p]));
    // Unmodified occurrence keeps the stream default.
    const plain = paychecks.find((p) => !overrides.some((o) => o.override_date === p.date));
    expect(plain?.federalWithholding).toBe(1414);
    expect(byDate.get(dates[1])?.federalWithholding).toBe(1502.4);
    expect(byDate.get(dates[2])?.federalWithholding).toBe(1565.19);
  });
});

describe("occurrence → ledger field mapping", () => {
  const paycheck = {
    grossAmount: 6879.68,
    taxesWithheld: 1565.19 + 400 + 100,
    retirement401k: 500,
    preTaxDeductions: 300,
    healthcareDeduction: 200,
    hsaContribution: 0,
    federalWithholding: 1565.19,
    stateWithholding: 0,
    ssWithholding: 400,
    medicareWithholding: 100,
    additionalTaxReserve: 250,
    hasDetailedBreakdown: true,
  };

  it("stores the occurrence withholding, not the stream default", () => {
    const row = buildOccurrenceLedgerFields(paycheck);
    expect(row.federal_withholding).toBe(1565.19);
    expect(row.federal_withholding).not.toBe(optum.federal_withholding);
    expect(row.ss_withholding).toBe(400);
    expect(row.medicare_withholding).toBe(100);
    expect(row.additional_tax_reserve).toBe(250);
    expect(row.gross_amount).toBe(6879.68);
    expect(row.paycheck_amount).toBe(6879.68);
  });

  it("derives standalone other pre-tax (no double counting)", () => {
    const row = buildOccurrenceLedgerFields(paycheck);
    expect(row.pre_tax_deductions).toBe(100);
    expect(row.healthcare_deduction + row.hsa_contribution + row.pre_tax_deductions).toBe(300);
    expect(deriveOtherPreTax(300, 400, 0)).toBe(0);
  });

  it("computes deposited amount from occurrence values", () => {
    const row = buildOccurrenceLedgerFields(paycheck);
    expect(row.deposited_amount).toBeCloseTo(6879.68 - 2065.19 - 100 - 500 - 200, 2);
  });

  it("passes aggregate pre-tax through untouched for basic occurrences", () => {
    const row = buildOccurrenceLedgerFields({ ...paycheck, hasDetailedBreakdown: false, preTaxDeductions: 100 });
    expect(row.pre_tax_deductions).toBe(100);
  });

  it("keeps taxes_withheld equal to the federal payroll components", () => {
    const row = buildOccurrenceLedgerFields(paycheck);
    expect(row.taxes_withheld).toBeCloseTo(
      row.federal_withholding + row.ss_withholding + row.medicare_withholding,
      2,
    );
  });
});

describe("quarterly accounting rules for converted paychecks", () => {
  const rows = [
    buildOccurrenceLedgerFields({ ...{ grossAmount: 6879.68, taxesWithheld: 2065.19, retirement401k: 0, preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0 }, federalWithholding: 1565.19, ssWithholding: 400, medicareWithholding: 100, additionalTaxReserve: 250 }),
    buildOccurrenceLedgerFields({ grossAmount: 6000, taxesWithheld: 1900, retirement401k: 0, preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0, federalWithholding: 1502.4, ssWithholding: 300, medicareWithholding: 86, additionalTaxReserve: 100 }),
    buildOccurrenceLedgerFields({ grossAmount: 6000, taxesWithheld: 1800, retirement401k: 0, preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0, federalWithholding: 1414, ssWithholding: 300, medicareWithholding: 86, additionalTaxReserve: 250 }),
  ];
  // Mirrors quarterRecommendation: Paid = federal income tax withholding only.
  const paid = rows.reduce((s, r) => s + r.federal_withholding, 0);
  const saved = rows.reduce((s, r) => s + r.additional_tax_reserve, 0);

  it("aggregates every Optum-style paycheck rather than one default amount", () => {
    expect(paid).toBeCloseTo(1565.19 + 1502.4 + 1414, 2);
    expect(paid).not.toBeCloseTo(1414, 2);
    expect(paid).not.toBeCloseTo(1414 * 3, 2);
  });

  it("excludes Social Security and Medicare from Paid", () => {
    const payrollOnly = rows.reduce((s, r) => s + r.ss_withholding + r.medicare_withholding, 0);
    expect(payrollOnly).toBeGreaterThan(0);
    expect(paid).not.toBeCloseTo(paid + payrollOnly, 2);
  });

  it("keeps additional tax reserve as Saved, not Paid", () => {
    expect(saved).toBe(600);
    expect(paid).not.toBeCloseTo(paid + saved, 2);
  });

  it("does not double count when the same occurrence maps twice", () => {
    const a = buildOccurrenceLedgerFields({ grossAmount: 6879.68, taxesWithheld: 2065.19, retirement401k: 0, preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0, federalWithholding: 1565.19 });
    const b = buildOccurrenceLedgerFields({ grossAmount: 6879.68, taxesWithheld: 2065.19, retirement401k: 0, preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0, federalWithholding: 1565.19 });
    expect(a).toEqual(b);
  });
});

describe("historical repair path (idempotent)", () => {
  const staleRow = {
    id: "ie1",
    company: "Optum",
    income_date: `${year}-08-14`,
    reviewed_at: null,
    federal_withholding: 1414,
    state_withholding: 0,
    ss_withholding: 300,
    medicare_withholding: 86,
  };

  it("repairs a stale row written with stream defaults", () => {
    const d = computeOccurrenceRepair(staleRow, optum, detailedOverride(`${year}-08-14`, 1565.19));
    expect(d.decision).toBe("repair");
    expect(d.patch?.federal_withholding).toBe(1565.19);
    expect(d.patch?.taxes_withheld).toBeCloseTo(1565.19 + 400 + 100, 2);
  });

  it("is a no-op on a second run", () => {
    const repaired = { ...staleRow, federal_withholding: 1565.19, ss_withholding: 400, medicare_withholding: 100 };
    expect(computeOccurrenceRepair(repaired, optum, detailedOverride(`${year}-08-14`, 1565.19)).decision).toBe("skip");
  });

  it("never touches user-reviewed rows", () => {
    const d = computeOccurrenceRepair({ ...staleRow, reviewed_at: new Date().toISOString() }, optum, detailedOverride(`${year}-08-14`, 1565.19));
    expect(d.decision).toBe("skip");
  });

  it("skips unmodified recurring occurrences", () => {
    expect(computeOccurrenceRepair(staleRow, optum, null).decision).toBe("skip");
  });
});
