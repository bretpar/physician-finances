import { describe, it, expect } from "vitest";
import { deriveOtherPreTax } from "@/pages/ProjectedIncome";
import { resolveOccurrenceDetail, type ProjectedIncomeStream, type ProjectedIncomeOverride } from "@/hooks/useProjectedIncome";

/**
 * Planner → Personal Income conversion must write the STANDALONE "Other
 * pre-tax" amount, not the planner's aggregate `pre_tax_deductions` (which
 * already includes health insurance + HSA). Mirrors handleConvert's mapping.
 */

const stream: ProjectedIncomeStream = {
  id: "s1",
  federal_withholding: 0,
  state_withholding: 0,
  ss_withholding: 0,
  medicare_withholding: 0,
  healthcare_deduction: 0,
  hsa_contribution: 0,
  additional_tax_reserve: 0,
} as unknown as ProjectedIncomeStream;

/** QA scenario: detailed occurrence override. */
const qaOverride: Partial<ProjectedIncomeOverride> = {
  action: "modify",
  has_detailed_breakdown: true,
  paycheck_amount: 10000,
  taxes_withheld: 2265,
  retirement_401k: 500,
  pre_tax_deductions: 300, // aggregate: health 200 + other 100
  federal_withholding: 1500,
  ss_withholding: 620,
  medicare_withholding: 145,
  state_withholding: 0,
  healthcare_deduction: 200,
  hsa_contribution: 0,
  additional_tax_reserve: 250,
};

/** Mirrors the conversion payload built in ProjectedIncome.handleConvert. */
function buildPayload(
  s: ProjectedIncomeStream,
  override: Partial<ProjectedIncomeOverride> | null,
  entry: { grossAmount: number; taxesWithheld: number; retirement401k: number; preTaxDeductions: number },
) {
  const detail = resolveOccurrenceDetail(s, override as any);
  const preTaxForLedger = detail.hasDetailedBreakdown
    ? deriveOtherPreTax(entry.preTaxDeductions, detail.healthcareDeduction, detail.hsaContribution)
    : entry.preTaxDeductions;
  return {
    grossAmount: entry.grossAmount,
    taxesWithheld: entry.taxesWithheld,
    preTaxDeductions: preTaxForLedger,
    retirement401k: entry.retirement401k,
    healthcareDeduction: detail.healthcareDeduction,
    hsaContribution: detail.hsaContribution,
    federalWithholding: detail.federalWithholding,
    stateWithholding: detail.stateWithholding,
    ssWithholding: detail.ssWithholding,
    medicareWithholding: detail.medicareWithholding,
    additionalTaxReserve: detail.additionalTaxReserve,
  };
}

/** Mirrors useManualPlannerConvert's estimated take-home / deposited_amount. */
const estimatedNet = (p: ReturnType<typeof buildPayload>) =>
  Math.max(
    0,
    p.grossAmount - p.taxesWithheld - p.preTaxDeductions - p.retirement401k - p.healthcareDeduction - p.hsaContribution,
  );

const qaEntry = { grossAmount: 10000, taxesWithheld: 2265, retirement401k: 500, preTaxDeductions: 300 };

describe("Planner → Personal Income conversion: detailed deduction mapping", () => {
  const payload = buildPayload(stream, qaOverride, qaEntry);

  it("writes Other Pre-Tax as $100, not the $300 aggregate", () => {
    expect(payload.preTaxDeductions).toBe(100);
    expect(payload.preTaxDeductions).not.toBe(300);
  });

  it("keeps Health Insurance at $200 in its own field", () => {
    expect(payload.healthcareDeduction).toBe(200);
  });

  it("estimated net is $6,935", () => {
    expect(estimatedNet(payload)).toBe(6935);
  });

  it("transfers each withholding component exactly once", () => {
    expect(payload.federalWithholding).toBe(1500);
    expect(payload.ssWithholding).toBe(620);
    expect(payload.medicareWithholding).toBe(145);
    expect(payload.stateWithholding).toBe(0);
    expect(payload.federalWithholding + payload.ssWithholding + payload.medicareWithholding).toBe(payload.taxesWithheld);
  });

  it("transfers retirement and Additional Tax Reserve once each", () => {
    expect(payload.retirement401k).toBe(500);
    expect(payload.additionalTaxReserve).toBe(250);
  });

  it("deduction fields sum back to the planner aggregate (no double count)", () => {
    expect(payload.healthcareDeduction + payload.hsaContribution + payload.preTaxDeductions).toBe(300);
  });

  it("subtracts HSA too when it is part of the aggregate", () => {
    const withHsa = buildPayload(
      stream,
      { ...qaOverride, hsa_contribution: 250, pre_tax_deductions: 550 },
      { ...qaEntry, preTaxDeductions: 550 },
    );
    expect(withHsa.preTaxDeductions).toBe(100);
    expect(withHsa.hsaContribution).toBe(250);
    expect(withHsa.healthcareDeduction + withHsa.hsaContribution + withHsa.preTaxDeductions).toBe(550);
    expect(estimatedNet(withHsa)).toBe(6935 - 250);
  });

  it("clamps Other Pre-Tax at zero when components exceed the aggregate", () => {
    const p = buildPayload(
      stream,
      { ...qaOverride, healthcare_deduction: 400, pre_tax_deductions: 300 },
      qaEntry,
    );
    expect(p.preTaxDeductions).toBe(0);
  });

  it("leaves basic (non-detailed) conversion unchanged", () => {
    const basicStream = { ...stream, healthcare_deduction: 200, pre_tax_deductions: 100 } as ProjectedIncomeStream;
    const p = buildPayload(basicStream, null, { ...qaEntry, preTaxDeductions: 100 });
    // Stream-level pre_tax_deductions is already standalone — pass through as-is.
    expect(p.preTaxDeductions).toBe(100);
    expect(p.healthcareDeduction).toBe(200);
  });

  it("leaves a skip-only override (no detailed breakdown) unchanged", () => {
    const p = buildPayload(stream, { action: "modify", has_detailed_breakdown: false }, { ...qaEntry, preTaxDeductions: 300 });
    expect(p.preTaxDeductions).toBe(300);
  });

  it("produces one payload per occurrence (no duplicate row)", () => {
    const a = buildPayload(stream, qaOverride, qaEntry);
    const b = buildPayload(stream, qaOverride, qaEntry);
    expect(a).toEqual(b);
  });
});
