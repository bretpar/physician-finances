import { describe, expect, it } from "vitest";
import {
  calcW2PayrollTax,
  EMPLOYEE_SS_RATE,
  EMPLOYEE_MEDICARE_RATE,
  ADDITIONAL_MEDICARE_RATE,
} from "@/lib/w2PayrollTax";

// Explicit constants so these fixtures survive tax-year rollovers.
const SS_CAP = 176100; // 2025 base
const SINGLE_ADDL = 200000;
const MFJ_ADDL = 250000;

describe("W-2 payroll tax (employee FICA)", () => {
  it("under SS cap: SS taxes all wages, Medicare taxes all wages, no addl", () => {
    const wages = 100000;
    const r = calcW2PayrollTax(wages, "single", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.ssTaxableWages).toBe(wages);
    expect(r.ssWagesAboveCap).toBe(0);
    expect(r.ssCapReached).toBe(false);
    expect(r.ssTax).toBeCloseTo(wages * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTaxableWages).toBe(wages);
    expect(r.medicareTax).toBeCloseTo(wages * EMPLOYEE_MEDICARE_RATE, 6);
    expect(r.additionalMedicareWages).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
  });

  it("at SS cap exactly: SS maxed, Medicare on full wages, no addl", () => {
    const r = calcW2PayrollTax(SS_CAP, "single", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.ssTaxableWages).toBe(SS_CAP);
    expect(r.ssWagesAboveCap).toBe(0);
    expect(r.ssCapReached).toBe(true);
    expect(r.ssTax).toBeCloseTo(SS_CAP * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTax).toBeCloseTo(SS_CAP * EMPLOYEE_MEDICARE_RATE, 6);
  });

  it("over SS cap: SS capped, Medicare continues, addl kicks in above threshold (single)", () => {
    const wages = 300000;
    const r = calcW2PayrollTax(wages, "single", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.ssCapReached).toBe(true);
    expect(r.ssTaxableWages).toBe(SS_CAP);
    expect(r.ssWagesAboveCap).toBe(wages - SS_CAP);
    expect(r.ssTax).toBeCloseTo(SS_CAP * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTaxableWages).toBe(wages);
    expect(r.medicareTax).toBeCloseTo(wages * EMPLOYEE_MEDICARE_RATE, 6);
    expect(r.additionalMedicareWages).toBe(wages - SINGLE_ADDL);
    expect(r.additionalMedicareTax).toBeCloseTo(
      (wages - SINGLE_ADDL) * ADDITIONAL_MEDICARE_RATE,
      6,
    );
  });

  it("MFJ threshold is higher: same wages may not trigger addl Medicare", () => {
    const wages = 240000;
    const r = calcW2PayrollTax(wages, "married_filing_jointly", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: MFJ_ADDL,
    });
    expect(r.additionalMedicareWages).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
  });

  it("zero/negative wages produce zero taxes", () => {
    const r = calcW2PayrollTax(-5000, "single");
    expect(r.ficaWages).toBe(0);
    expect(r.ssTax).toBe(0);
    expect(r.medicareTax).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
    expect(r.totalPayrollTax).toBe(0);
  });
});

// ============================================================================
// Section 125 (payroll HSA + qualified health premiums) regression fixtures.
// These are the audit tests for the FICA-wages bug where payroll HSA was being
// taxed for Social Security and Medicare.
// ============================================================================
describe("W-2 payroll tax — Section 125 exclusion (payroll HSA + health premiums)", () => {
  it("A. Payroll HSA is excluded from BOTH Social Security AND Medicare wages", () => {
    const gross = 100000;
    const hsa = 4000;
    const r = calcW2PayrollTax({
      grossW2Wages: gross,
      filingStatus: "single",
      payrollHsa: hsa,
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    const expectedFica = gross - hsa;
    expect(r.section125Deductions).toBe(hsa);
    expect(r.ficaWages).toBe(expectedFica);
    expect(r.ssTaxableWages).toBe(expectedFica);
    expect(r.medicareTaxableWages).toBe(expectedFica);
    expect(r.ssTax).toBeCloseTo(expectedFica * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTax).toBeCloseTo(expectedFica * EMPLOYEE_MEDICARE_RATE, 6);
  });

  it("B. Qualified Section 125 health premiums are also FICA-excluded and add to payroll HSA", () => {
    const gross = 90000;
    const hsa = 3000;
    const premiums = 2500;
    const r = calcW2PayrollTax({
      grossW2Wages: gross,
      filingStatus: "single",
      payrollHsa: hsa,
      qualifiedSection125Premiums: premiums,
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    const expectedFica = gross - hsa - premiums;
    expect(r.section125Deductions).toBe(hsa + premiums);
    expect(r.ficaWages).toBe(expectedFica);
    expect(r.ssTax).toBeCloseTo(expectedFica * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTax).toBeCloseTo(expectedFica * EMPLOYEE_MEDICARE_RATE, 6);
  });

  it("C. 401(k) is NOT Section 125 — passing zero for HSA/premiums keeps FICA on gross", () => {
    // Callers must NOT pass 401(k) into payrollHsa / qualifiedSection125Premiums;
    // this test enforces that the calculator has no hidden 401(k) subtraction.
    const gross = 150000;
    const r = calcW2PayrollTax({
      grossW2Wages: gross,
      filingStatus: "single",
      payrollHsa: 0,
      qualifiedSection125Premiums: 0,
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.section125Deductions).toBe(0);
    expect(r.ficaWages).toBe(gross);
    expect(r.ssTax).toBeCloseTo(gross * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTax).toBeCloseTo(gross * EMPLOYEE_MEDICARE_RATE, 6);
  });

  it("D. Section 125 reduces Additional Medicare Tax base (threshold is on FICA wages)", () => {
    const gross = 210000;
    const hsa = 15000;
    const r = calcW2PayrollTax({
      grossW2Wages: gross,
      filingStatus: "single",
      payrollHsa: hsa,
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    const expectedFica = gross - hsa; // 195,000
    // Below the $200k single threshold → no Additional Medicare on wages.
    expect(r.ficaWages).toBe(expectedFica);
    expect(r.additionalMedicareWages).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
  });

  it("E. Section 125 that pushes FICA under the SS cap still SS-taxes ALL of it", () => {
    const gross = SS_CAP + 5000;
    const hsa = 10000;
    const r = calcW2PayrollTax({
      grossW2Wages: gross,
      filingStatus: "single",
      payrollHsa: hsa,
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    const expectedFica = gross - hsa; // now under cap
    expect(r.ficaWages).toBe(expectedFica);
    expect(r.ssCapReached).toBe(false);
    expect(r.ssTaxableWages).toBe(expectedFica);
    expect(r.ssWagesAboveCap).toBe(0);
    expect(r.ssTax).toBeCloseTo(expectedFica * EMPLOYEE_SS_RATE, 6);
  });

  it("F. Section 125 larger than gross wages cannot produce negative FICA wages", () => {
    const r = calcW2PayrollTax({
      grossW2Wages: 20000,
      filingStatus: "single",
      payrollHsa: 25000,
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.ficaWages).toBe(0);
    expect(r.ssTax).toBe(0);
    expect(r.medicareTax).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
    expect(r.totalPayrollTax).toBe(0);
  });
});
