import { describe, expect, it } from "vitest";
import { format, addDays } from "date-fns";
import { fsaTotal, getFsaLimits, plannerFsaNotes, projectFsa, readPlannerFsa, refreshFsaDefaults, summarizeFsa } from "@/lib/fsaDeductions";
import { buildPersonalPreviewInput, buildPersonalSaveInput } from "@/lib/personalIncomeRecommendationAdapters";
import { calcW2PayrollTax, paycheckSection125 } from "@/lib/w2PayrollTax";
import { generateProjectedPaychecks, getProjectedTotals, type ProjectedIncomeStream, type ProjectedBonusEvent } from "@/hooks/useProjectedIncome";
import { buildOccurrenceLedgerFields } from "@/lib/plannerOccurrenceLedger";
import { buildIncomeEntryRow } from "@/hooks/usePersonalIncome";
import { computeUnifiedTaxEstimate } from "@/lib/taxCalculationService";
import { applyFsa, ledgerFields, resolveOccurrence } from "../../supabase/functions/planner-convert-daily/calc";

const cfg = {
  health: { enabled: true, perPaycheck: 100, startDate: "2026-01-01", endDate: "2026-12-31", annualElection: null },
  dependent_care: { enabled: true, perPaycheck: 200, startDate: null, endDate: null, annualElection: null },
  limited_purpose: { enabled: true, perPaycheck: 50, startDate: null, endDate: null, annualElection: null },
};
const date = format(addDays(new Date(), 3), "yyyy-MM-dd");
const stream = { id: "fsa-stream", company: "Employer", company_type: "w2", source_id: "co", pay_frequency: "single", start_date: date,
  end_date: null, paycheck_amount: 5000, taxes_withheld: 1000, retirement_401k: 0, employer_retirement_contribution: 0,
  pre_tax_deductions: 25, healthcare_deduction: 0, hsa_contribution: 0, state_withholding: 0, federal_withholding: 1000,
  ss_withholding: 0, medicare_withholding: 0, additional_tax_reserve: 0, is_active: true, include_in_tax: true, notes: "", custom_interval_days: null } as ProjectedIncomeStream;
const permanentCfg = { ...cfg, health: { ...cfg.health, startDate: null, endDate: null } };
const run = (s = stream, overrides: any[] = [], conversions: any[] = []) => generateProjectedPaychecks([s], [], [], overrides, conversions, [], undefined, null, undefined, { [s.id]: permanentCfg })[0];

describe("FSA release regression", () => {
  it("ordinary $5,000 paycheck deducts $100 FSA, $100 payroll HSA and $200 pre-tax healthcare once", () => {
    const s = { ...stream, taxes_withheld: 0, federal_withholding: 0, pre_tax_deductions: 0, hsa_contribution: 100, healthcare_deduction: 200 };
    const healthOnly = { health: permanentCfg.health };
    const companies = [{ id: "co", companyType: "w2", advancedFieldVisibility: { healthcare_pretax_payroll: true } }];
    for (const other of [0, 25]) {
      for (const detailed of [false, true]) {
        const overrides = detailed ? [{ stream_id: s.id, override_date: date, new_date: null, action: "modify", paycheck_amount: 5000, taxes_withheld: 0, retirement_401k: 0,
          pre_tax_deductions: 300 + other, healthcare_deduction: 200, hsa_contribution: 100, has_detailed_breakdown: true, notes: "" }] : [];
        const p = generateProjectedPaychecks([{ ...s, pre_tax_deductions: other }], [], [], overrides as any, [], [], undefined, null, undefined, { [s.id]: healthOnly })[0];
        const totals = getProjectedTotals([p], [s], companies);
        expect(p.netAmount).toBe(4600 - other);
        expect(totals.netIncome).toBe(4600 - other);
        expect(totals.w2Income - totals.preTaxDeductions).toBe(4600 - other);
        expect(totals.section125Deductions).toBe(400);
        expect(totals.w2Income - totals.section125Deductions).toBe(4600);
        const client = buildOccurrenceLedgerFields(p);
        expect(client.deposited_amount).toBe(4600 - other);
        expect(paycheckSection125(client, true)).toBe(400);
        const daily = ledgerFields(applyFsa(resolveOccurrence({ ...s, pre_tax_deductions: other }, overrides[0], date), { fsa_deductions: healthOnly }, true), false);
        expect(daily).toMatchObject(client);
      }
    }
  });
  it("a $5,000 bonus never inherits the $100 recurring FSA in scheduled or manual conversion", () => {
    const bonus = { id: "bonus", stream_id: stream.id, name: "Bonus", amount: 5000, taxes_withheld: 0, scheduled_date: date, frequency: "one-time" } as ProjectedBonusEvent;
    const p = generateProjectedPaychecks([stream], [bonus], [], [], [], [], undefined, null, undefined, { [stream.id]: { health: permanentCfg.health } }).find((p) => p.type === "bonus");
    expect(p).toBeDefined();
    if (!p) throw new Error("Missing projected bonus");
    const client = buildOccurrenceLedgerFields(p);
    const occurrence = { ...p, amount: p.grossAmount, employerRetirement: 0 };
    const daily = ledgerFields(applyFsa(occurrence, { fsa_deductions: { health: permanentCfg.health } }, true), false);
    expect(p.netAmount).toBe(5000);
    expect(daily).toMatchObject(client);
    expect(daily.deposited_amount).toBe(5000);
    expect(daily.fsa_health).toBe(0);
    const explicit = { ...occurrence, preTaxDeductions: 40, fsaDeductions: { health: 40 } };
    expect(applyFsa(explicit, { fsa_deductions: permanentCfg }, true)).toBe(explicit);
    expect(ledgerFields(explicit, false).deposited_amount).toBe(4960);
  });
  it("preview and saved reminder include all three amounts once", () => {
    const form = { gross_amount: "5000", income_type: "w2_user", federal_withholding: "1000", ss_withholding: "", medicare_withholding: "", state_withholding: "", retirement_pretax: "", deductions_pre_tax: "25", healthcare_deduction: "", hsa_contribution: "", fsa_health: "100", fsa_dependent_care: "200", fsa_limited_purpose: "50" };
    const ctx = { totalFederalPayrollTaxes: 1000, stateIncomeTaxEnabled: false, isFutureOpportunity: true };
    expect(buildPersonalPreviewInput(form, ctx).preTaxDeductions).toBe(375);
    expect(buildPersonalSaveInput(form, ctx).preTaxDeductions).toBe(375);
    expect(buildPersonalPreviewInput({ ...form, deductions_pre_tax: "375", preTaxIncludesFsa: true }, ctx).preTaxDeductions).toBe(375);
  });
  it("refreshes employer/date defaults, clears unlinked defaults, preserves manual and historical values", () => {
    const original = { fsa_health: "100", fsa_dependent_care: "200", fsa_limited_purpose: "50" };
    expect(refreshFsaDefaults(original, cfg, "2027-01-01", {}, false).fsa_health).toBe("");
    expect(refreshFsaDefaults(original, {}, "2026-03-01", { health: true }, false)).toEqual({ fsa_health: "100", fsa_dependent_care: "", fsa_limited_purpose: "" });
    expect(refreshFsaDefaults(original, {}, "2027-01-01", {}, true)).toBe(original);
  });
  it("shares remaining health capacity and retains published/inferred year limits", () => {
    const s = summarizeFsa({ year: 2026, filingStatus: "single", configsByCompany: { co: permanentCfg }, rows: [{ source_id: "co", income_date: "2026-03-01", fsa_health: 2000, fsa_limited_purpose: 500 }] });
    expect(s.kinds.find((k) => k.kind === "health")?.remaining).toBe(900);
    expect(s.kinds.find((k) => k.kind === "limited_purpose")?.remaining).toBe(900);
    expect(getFsaLimits(2027).health).toBe(3500);
    expect(getFsaLimits(2027).inferred).toBe(false);
    expect(getFsaLimits(2028).inferred).toBe(true);
  });
  it("leaves unrelated pre-tax intact and does not add explicitly included FSA twice", () => {
    const included = { health: 100, dependent_care: 200, limited_purpose: 50 };
    const s = { ...stream, pre_tax_deductions: 375, notes: plannerFsaNotes("Shift", included) };
    expect(readPlannerFsa(s.notes)).toEqual(included);
    const p = run(s);
    expect(p.preTaxDeductions).toBe(375);
    expect(p.netAmount).toBe(3625);
    expect(p.fsaAddedAmount).toBe(0);
    expect(run().netAmount).toBe(3625);
    expect(run().fsaAddedAmount).toBe(350);
    expect(projectFsa(25, permanentCfg, date, { health: 0 }).preTaxDeductions).toBe(275);
  });
  it("preserves each FSA breakdown through conversion and annual summary", () => {
    const p = run();
    const ledger = buildOccurrenceLedgerFields({ ...p, grossAmount: p.grossAmount, stateSeparate: true });
    const row = buildIncomeEntryRow({ ...ledger, income_type: "w2", income_date: date, source_id: "co" } as any);
    expect([row.fsa_health, row.fsa_dependent_care, row.fsa_limited_purpose]).toEqual([100, 200, 50]);
    expect(row.pre_tax_deductions).toBe(375);
    expect(row.deposited_amount).toBe(3625);
    const summary = summarizeFsa({ year: Number(date.slice(0, 4)), filingStatus: "single", rows: [row], configsByCompany: { co: permanentCfg } });
    expect(summary.kinds.map((k) => k.contributed)).toEqual([100, 200, 50]);
  });
  it("converted occurrences never remain active forecasts", () => {
    const p = run(stream, [], [{ stream_id: stream.id, bonus_event_id: null, occurrence_date: date, status: "converted", converted_personal_income_id: "ledger" }]);
    expect(p.matchStatus).toBe("converted");
    expect(getProjectedTotals([p], [stream]).grossIncome).toBe(0);
  });
  it("daily conversion is identical to the client for defaults and explicit included values", () => {
    for (const s of [stream, { ...stream, pre_tax_deductions: 375, notes: plannerFsaNotes("", { health: 100, dependent_care: 200, limited_purpose: 50 }) }]) {
      const p = run(s);
      const daily = ledgerFields(applyFsa(resolveOccurrence(s, undefined, date), { fsa_deductions: permanentCfg }, true), false);
      const client = buildOccurrenceLedgerFields({ ...p, stateSeparate: true });
      expect(daily).toMatchObject({ pre_tax_deductions: client.pre_tax_deductions, deposited_amount: client.deposited_amount, fsa_health: 100, fsa_dependent_care: 200, fsa_limited_purpose: 50 });
    }
  });
  it("FICA classifies FSA, HSA and designated premiums but not Other Pre-Tax or retirement", () => {
    const section125 = paycheckSection125({ pre_tax_deductions: 500, fsa_health: 100, fsa_dependent_care: 200, fsa_limited_purpose: 50, hsa_contribution: 30, healthcare_deduction: 20 }, true);
    expect(section125).toBe(400);
    expect(calcW2PayrollTax({ grossW2Wages: 5000, filingStatus: "single", payrollFsa: 350 }).ficaWages).toBe(4650);
    expect(getProjectedTotals([run()], [stream]).section125Deductions).toBe(350);
  });
  it("FSA respects Social Security and Additional Medicare boundaries", () => {
    const r = calcW2PayrollTax({ grossW2Wages: 210000, payrollFsa: 10000, filingStatus: "single", ssWageCap: 184500 });
    expect(r.ficaWages).toBe(200000);
    expect(r.ssTaxableWages).toBe(184500);
    expect(r.additionalMedicareTax).toBe(0);
  });
  it("forecast taxable wages and FICA consume one shared FSA total", () => {
    const p = run();
    const totals = getProjectedTotals([p], [stream]);
    const result = computeUnifiedTaxEstimate({ ownerHealthcare: 0, businessStateEligibleGross: 0, businessStateEligibleExpenses: 0, businessStateEligibleMileage: 0, businessStateEligibleOwnerAdjustments: 0, businessIncome: 0, seEligibleBusinessIncome: 0, businessW2: 0, businessFederalWithheld: 0, businessStateWithheld: 0, businessPreTax: 0, businessRetirement: 0,
      personalIncome: 0, personalW2: 0, personalNonW2Income: 0, personalFederalWithheld: 0, personalStateWithheld: 0, personalPreTax: 0, personalRetirement: 0, netStockGain: 0, businessExpenses: 0, mileageDeduction: 0,
      annualizedRetirement: 0, txActualWithholding: 0, actualEstimatedPaymentsMade: 0, taxSavingsSetAside: 0, remainingPayPeriods: 1,
      projectedW2Income: totals.w2Income, projectedSEIncome: 0, projectedOtherIncome: 0, projectedFederalWithheld: 0, projectedStateWithheld: 0, projectedPreTax: totals.preTaxDeductions, projectedSection125: totals.section125Deductions,
      projectedRetirement: 0, projectedHealthInsuranceDeduction: 0, filingStatus: "single", lastYearTax: 0, ssWageCap: 184500, includeProjectedIncome: true } as any);
    expect(result.estimate.w2TaxableIncomeBase).toBe(4625);
    expect(result.estimate.seTax.plannedW2SsWagesUsed).toBe(4650);
    expect(fsaTotal(p.fsaDeductions ?? {})).toBe(350);
  });
});