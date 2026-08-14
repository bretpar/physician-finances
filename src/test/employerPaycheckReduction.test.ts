/**
 * Employer retirement / HSA contributions: paycheck-reduction settings.
 *
 * Classification never changes (employer retirement stays employer retirement,
 * employer HSA stays employer HSA). The per-company settings only control
 * whether the amount reduces Estimated Net / cash received.
 */
import { describe, it, expect } from "vitest";
import {
  resolveEmployerPaycheckReduction,
  resolveAdvancedVisibility,
  EMPLOYER_RETIREMENT_REDUCES_PAYCHECK_KEY,
  EMPLOYER_HSA_REDUCES_PAYCHECK_KEY,
} from "@/lib/filingTypes";
import { computeEstimatedNet, employerPaycheckReductions } from "@/lib/estimatedNet";
import { buildIncomeEntryRow } from "@/hooks/usePersonalIncome";

const parentsOn = {
  employer_retirement_contribution: true,
  employer_hsa_contribution: true,
};

// QA example
const qa = {
  gross: 15_342,
  federal: 0,
  ss: 0,
  medicare: 0,
  aggregateFederalPayrollTaxes: 0,
  state: 0,
  retirement: 459,
  otherPreTax: 0,
  healthcare: 2_493,
  hsa: 200,
  employerRetirement: 1_000,
  employerHsa: 300,
};
const baseNet = 15_342 - 459 - 2_493 - 200; // 12,190

describe("employer paycheck-reduction settings", () => {
  it("defaults both settings OFF when nothing is saved", () => {
    const r = resolveEmployerPaycheckReduction("w2", parentsOn);
    expect(r.retirement).toBe(false);
    expect(r.hsa).toBe(false);
  });

  it("hides/neutralizes the child setting when the parent field is disabled", () => {
    const saved = {
      employer_retirement_contribution: false,
      employer_hsa_contribution: false,
      [EMPLOYER_RETIREMENT_REDUCES_PAYCHECK_KEY]: true,
      [EMPLOYER_HSA_REDUCES_PAYCHECK_KEY]: true,
    };
    const visibility = resolveAdvancedVisibility("w2", saved);
    expect(visibility.employer_retirement_contribution).toBe(false);
    expect(visibility.employer_hsa_contribution).toBe(false);
    const r = resolveEmployerPaycheckReduction("w2", saved);
    expect(r.retirement).toBe(false);
    expect(r.hsa).toBe(false);
  });

  it("persists the two settings independently per company", () => {
    const companyA = { ...parentsOn, [EMPLOYER_RETIREMENT_REDUCES_PAYCHECK_KEY]: true };
    const companyB = { ...parentsOn, [EMPLOYER_HSA_REDUCES_PAYCHECK_KEY]: true };
    expect(resolveEmployerPaycheckReduction("w2", companyA)).toEqual({ retirement: true, hsa: false });
    expect(resolveEmployerPaycheckReduction("k1_partnership", companyB)).toEqual({ retirement: false, hsa: true });
  });

  it("both OFF preserves current Estimated Net behavior", () => {
    expect(computeEstimatedNet({ ...qa })).toBe(baseNet);
  });

  it("retirement ON only subtracts employer retirement", () => {
    expect(
      computeEstimatedNet({ ...qa, employerRetirementReducesPaycheck: true }),
    ).toBe(baseNet - 1_000);
  });

  it("HSA ON only subtracts employer HSA", () => {
    expect(computeEstimatedNet({ ...qa, employerHsaReducesPaycheck: true })).toBe(baseNet - 300);
  });

  it("both ON subtracts both employer amounts exactly once", () => {
    expect(
      computeEstimatedNet({
        ...qa,
        employerRetirementReducesPaycheck: true,
        employerHsaReducesPaycheck: true,
      }),
    ).toBe(baseNet - 1_300);
    expect(
      employerPaycheckReductions({
        employerRetirement: 1_000,
        employerRetirementReducesPaycheck: true,
        employerHsa: 300,
        employerHsaReducesPaycheck: true,
      }),
    ).toBe(1_300);
  });

  it("keeps contributions classified as employer-side regardless of the setting", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 15_342,
      retirement_401k: 459,
      employer_retirement_contribution: 1_000,
      hsa_contribution: 200,
      employer_hsa_contribution: 300,
    } as any);
    expect(row.retirement_401k).toBe(459);
    expect((row as any).employer_retirement_contribution).toBe(1_000);
    expect(row.hsa_contribution).toBe(200);
    expect((row as any).employer_hsa_contribution).toBe(300);
  });
});
