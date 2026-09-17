import { describe, it, expect } from "vitest";
import { getProjectedTotals, type ProjectedPaycheck, type ProjectedIncomeStream } from "./useProjectedIncome";

/**
 * Regression: projected federal withholding credited against annual federal
 * income-tax liability must include ONLY federal income tax withholding —
 * never Social Security, Medicare, or other payroll taxes — and must use
 * occurrence-level values (override > stream) for bonuses and modified
 * occurrences.
 */

function makeStream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s1",
    company: "Acme",
    company_type: "w2",
    pay_frequency: "biweekly",
    start_date: "2026-01-01",
    end_date: null,
    paycheck_amount: 5000,
    taxes_withheld: 1200, // canonical TOTAL payroll taxes (fed + SS + Medicare)
    federal_withholding: 700, // federal income tax only
    ss_withholding: 310,
    medicare_withholding: 190,
    state_withholding: 0,
    retirement_401k: 0,
    pre_tax_deductions: 0,
    healthcare_deduction: 0,
    hsa_contribution: 0,
    additional_tax_reserve: 0,
    is_active: true,
    include_in_tax: true,
    notes: "",
    custom_interval_days: null,
    ...overrides,
  } as ProjectedIncomeStream;
}

function makePaycheck(overrides: Partial<ProjectedPaycheck> = {}): ProjectedPaycheck {
  return {
    date: "2026-06-15",
    grossAmount: 5000,
    taxesWithheld: 1200,
    federalWithholding: 700,
    stateWithholding: 0,
    ssWithholding: 310,
    medicareWithholding: 190,
    retirement401k: 0,
    preTaxDeductions: 0,
    healthcareDeduction: 0,
    hsaContribution: 0,
    netAmount: 3800,
    type: "paycheck",
    label: "Acme paycheck",
    streamId: "s1",
    matchStatus: "active",
    streamCompanyType: "w2",
    ...overrides,
  };
}

describe("getProjectedTotals — federal income-tax withholding only", () => {
  it("A. recurring W-2 paycheck: only federal income tax contributes (SS/Medicare excluded)", () => {
    const stream = makeStream();
    const totals = getProjectedTotals([makePaycheck()], [stream]);
    // 700 federal income tax — NOT 1200 (fed + SS + Medicare total).
    expect(totals.federalWithheld).toBe(700);
    expect(totals.federalWithheld).not.toBe(1200);
  });

  it("B. bonus occurrence: uses the bonus's own federal withholding, not the stream total", () => {
    const stream = makeStream();
    const bonus = makePaycheck({
      type: "bonus",
      label: "Acme bonus",
      grossAmount: 10000,
      taxesWithheld: 2200,
      federalWithholding: 1500, // bonus-specific federal income tax
      ssWithholding: 400,
      medicareWithholding: 300,
      bonusEventId: "b1",
    });
    const totals = getProjectedTotals([bonus], [stream]);
    expect(totals.federalWithheld).toBe(1500);
  });

  it("C. modified occurrence: uses occurrence-level federal withholding", () => {
    const stream = makeStream();
    const modified = makePaycheck({
      isModified: true,
      grossAmount: 6000,
      taxesWithheld: 1400,
      federalWithholding: 900, // modified withholding differs from stream
      ssWithholding: 310,
      medicareWithholding: 190,
      hasDetailedBreakdown: true,
    });
    const totals = getProjectedTotals([modified], [stream]);
    expect(totals.federalWithheld).toBe(900);
  });

  it("D. converted/matched occurrences contribute no projected withholding (no duplicates)", () => {
    const stream = makeStream();
    const converted = makePaycheck({ matchStatus: "matched" as any });
    const skipped = makePaycheck({ matchStatus: "skipped" as any });
    const totals = getProjectedTotals([converted, skipped], [stream]);
    expect(totals.federalWithheld).toBe(0);
    expect(totals.count).toBe(0);
  });

  it("E. converted/merged occurrence with zero federal withholding: no double-count, no parent inheritance", () => {
    const stream = makeStream();
    // A converted occurrence whose merged actual had $0 federal income-tax
    // withholding (e.g. a Roth-heavy or exempt paycheck). Its occurrence-level
    // fields are explicitly zero — it must contribute 0, not fall back to the
    // parent stream's 700, and the sibling active occurrence must be counted
    // exactly once.
    const convertedZeroFed = makePaycheck({
      date: "2026-06-01",
      matchStatus: "matched" as any, // converted/merged — excluded from projection
      taxesWithheld: 0,
      federalWithholding: 0,
      ssWithholding: 0,
      medicareWithholding: 0,
    });
    const active = makePaycheck({ date: "2026-06-15" });
    const totals = getProjectedTotals([convertedZeroFed, active], [stream]);
    // Only the active occurrence's 700 — the converted one adds nothing and
    // the parent stream total is never inherited for it.
    expect(totals.federalWithheld).toBe(700);
    expect(totals.count).toBe(1);
    expect(totals.federalWithheld).not.toBe(1400); // no double-count
  });

  it("F. active occurrence explicitly overridden to zero federal withholding stays zero", () => {
    const stream = makeStream();
    // An active occurrence whose override explicitly zeroes federal income-tax
    // withholding (hasDetailedBreakdown) must not inherit the stream's 700.
    const zeroed = makePaycheck({
      isModified: true,
      hasDetailedBreakdown: true,
      taxesWithheld: 500, // SS + Medicare only
      federalWithholding: 0,
      ssWithholding: 310,
      medicareWithholding: 190,
      stateWithholding: 0,
    });
    const totals = getProjectedTotals([zeroed], [stream]);
    expect(totals.federalWithheld).toBe(0);
  });

  it("projectedFederalWithheld equals the sum of federal income-tax withholding only", () => {
    const stream = makeStream();
    const paychecks = [
      makePaycheck({ date: "2026-06-15" }),
      makePaycheck({ date: "2026-06-29" }),
      makePaycheck({
        date: "2026-07-15",
        type: "bonus",
        grossAmount: 10000,
        taxesWithheld: 2200,
        federalWithholding: 1500,
        ssWithholding: 400,
        medicareWithholding: 300,
      }),
    ];
    const totals = getProjectedTotals(paychecks, [stream]);
    // 700 + 700 + 1500 = 2900 federal income tax only.
    expect(totals.federalWithheld).toBe(2900);
    // Explicitly NOT fed + SS + Medicare: (700+310+190)*2 + (1500+400+300) = 4600.
    expect(totals.federalWithheld).not.toBe(4600);
  });
});
