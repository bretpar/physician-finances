import { describe, it, expect } from "vitest";
import { format, addDays } from "date-fns";
import { estimatePaycheckEmployerMatch, employerMatchFormulaByStream, paycheckFormulaForCompany, resolvePaycheckEmployerAmount } from "@/lib/employerMatchPaycheck";
import { generateProjectedPaychecks, type ProjectedIncomeStream } from "@/hooks/useProjectedIncome";
import { writeEmployerContributionFormula, type EmployerContributionFormula } from "@/lib/employerContributionFormula";

const match: EmployerContributionFormula = { kind: "match", matchRate: 0.5, matchCapPct: 0.06 };
const future = format(addDays(new Date(), 3), "yyyy-MM-dd");
const stream = (o: Partial<ProjectedIncomeStream> = {}) => ({
  id: "s1", company: "Optum", company_type: "w2", pay_frequency: "single", start_date: future, end_date: null,
  paycheck_amount: 10000, taxes_withheld: 0, retirement_401k: 500, pre_tax_deductions: 0, healthcare_deduction: 0, hsa_contribution: 0,
  state_withholding: 0, federal_withholding: 0, ss_withholding: 0, medicare_withholding: 0, additional_tax_reserve: 0,
  is_active: true, include_in_tax: true, notes: "", custom_interval_days: null, source_id: "c1", ...o,
}) as ProjectedIncomeStream;
const gen = (s: ProjectedIncomeStream, opts: { entries?: unknown[]; reduces?: Record<string, boolean>; formulas?: Record<string, EmployerContributionFormula> } = {}) =>
  generateProjectedPaychecks([s], [], (opts.entries ?? []) as never, [], [], [], opts.reduces, null, opts.formulas ?? { s1: match });

describe("automatic employer match", () => {
  it("1. percentage match on a W-2 paycheck", () => {
    expect(estimatePaycheckEmployerMatch(match, 10000, 500)).toBe(250);
  });
  it("2. caps the match at the qualifying percent of pay", () => {
    expect(estimatePaycheckEmployerMatch(match, 10000, 1500)).toBe(300);
  });
  it("3. a manual employer amount beats the estimate", () => {
    expect(resolvePaycheckEmployerAmount({ mode: "manual", current: "123", formula: match, gross: 10000, employeeDeferral: 500 })).toBe("123");
    expect(resolvePaycheckEmployerAmount({ mode: "auto", current: "123", formula: match, gross: 10000, employeeDeferral: 500 })).toBe("250");
  });
  it("4. changing a future employee deferral recomputes the future estimate", () => {
    expect(gen(stream())[0].employerRetirementContribution).toBe(250);
    const p = gen(stream({ retirement_401k: 200 }))[0];
    expect(p.employerRetirementContribution).toBe(100);
    expect(p.employerMatchEstimated).toBe(true);
  });
  it("4b. an explicit Planner employer amount is kept", () => {
    const p = gen(stream({ employer_retirement_contribution: 75 } as never))[0];
    expect(p.employerRetirementContribution).toBe(75);
    expect(p.employerMatchEstimated).toBeFalsy();
  });
  it("5. a matched actual paycheck replaces the Planner estimate", () => {
    const entry = { id: "e1", income_date: future, gross_amount: 10000, paycheck_amount: 10000, source_id: "c1", company: "Optum", income_type: "w2", status: "received" };
    const p = gen(stream(), { entries: [entry] })[0];
    // The Retirement Planner counts only "active" occurrences, so a matched or suggested one adds no estimate.
    expect(p.matchStatus).not.toBe("active");
  });
  it("6. a flat annual formula is never repeated per paycheck", () => {
    const flat: EmployerContributionFormula = { kind: "flat", annualAmount: 2000 };
    expect(estimatePaycheckEmployerMatch(flat, 10000, 500)).toBeNull();
    const companies = [{ id: "c1", companyType: "w2", advancedFieldVisibility: writeEmployerContributionFormula({}, flat) }];
    expect(employerMatchFormulaByStream([{ id: "s1", source_id: "c1" }], companies)).toEqual({});
  });
  it("7. the employer amount lowers net pay only when the company setting is on", () => {
    expect(gen(stream(), { reduces: { s1: false } })[0].netAmount).toBe(9500);
    expect(gen(stream(), { reduces: { s1: true } })[0].netAmount).toBe(9250);
  });
  it("8. K-1 partnerships never get the W-2 formula", () => {
    const meta = writeEmployerContributionFormula({}, match);
    expect(paycheckFormulaForCompany({ companyType: "k1_partnership", advancedFieldVisibility: meta })).toBeNull();
    expect(paycheckFormulaForCompany({ companyType: "1099_schedule_c", advancedFieldVisibility: meta })).toBeNull();
    expect(paycheckFormulaForCompany({ companyType: "w2", advancedFieldVisibility: meta })).toEqual(match);
  });
});
