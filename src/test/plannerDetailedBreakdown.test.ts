import { describe, it, expect } from "vitest";
import { sumDetailedWithholding, sumDetailedDeductions } from "@/pages/ProjectedIncome";
import { resolveOccurrenceDetail, type ProjectedIncomeStream, type ProjectedIncomeOverride } from "@/hooks/useProjectedIncome";

/**
 * Focused coverage for the Income Planner "detailed tax & deduction breakdown"
 * toggle:
 *  1. basic totals stay synchronized with the detailed components (never summed
 *     on top of each other),
 *  2. detailed values become the source of truth and map 1:1 onto the Personal
 *     Income ledger fields during Planner → Ledger conversion.
 */

const form = (over: Partial<Record<string, string>> = {}) => ({
  federal_withholding: "0",
  ss_withholding: "0",
  medicare_withholding: "0",
  state_withholding: "0",
  healthcare_deduction: "0",
  hsa_contribution: "0",
  pre_tax_deductions: "0",
  ...over,
}) as any;

const stream: ProjectedIncomeStream = {
  id: "s1",
  federal_withholding: 111,
  state_withholding: 22,
  ss_withholding: 33,
  medicare_withholding: 44,
  healthcare_deduction: 55,
  hsa_contribution: 66,
  additional_tax_reserve: 77,
} as unknown as ProjectedIncomeStream;

const detailedOverride: Partial<ProjectedIncomeOverride> = {
  action: "modify",
  has_detailed_breakdown: true,
  federal_withholding: 900,
  state_withholding: 100,
  ss_withholding: 200,
  medicare_withholding: 50,
  healthcare_deduction: 150,
  hsa_contribution: 250,
  additional_tax_reserve: 300,
};

describe("detailed breakdown → basic totals sync", () => {
  it("sums only the withholding components into Tax Withholding", () => {
    expect(
      sumDetailedWithholding(
        form({ federal_withholding: "900", ss_withholding: "200", medicare_withholding: "50", state_withholding: "100" }),
      ),
    ).toBe(1250);
  });

  it("excludes deductions from the withholding total (no double counting)", () => {
    const f = form({
      federal_withholding: "500",
      healthcare_deduction: "300",
      hsa_contribution: "200",
      pre_tax_deductions: "100",
    });
    expect(sumDetailedWithholding(f)).toBe(500);
    expect(sumDetailedDeductions(f)).toBe(600);
  });

  it("treats blank / non-numeric inputs as zero", () => {
    expect(sumDetailedWithholding(form({ federal_withholding: "", ss_withholding: "abc" }))).toBe(0);
    expect(sumDetailedDeductions(form({ healthcare_deduction: "" }))).toBe(0);
  });

  it("computes estimated take-home from detailed totals when expanded", () => {
    const f = form({
      federal_withholding: "800",
      ss_withholding: "150",
      medicare_withholding: "50",
      healthcare_deduction: "200",
      pre_tax_deductions: "100",
    });
    const gross = 5000;
    const retirement = 500;
    const takeHome = gross - retirement - sumDetailedWithholding(f) - sumDetailedDeductions(f);
    expect(takeHome).toBe(5000 - 500 - 1000 - 300);
  });
});

describe("resolveOccurrenceDetail — source of truth", () => {
  it("uses stream values when there is no override", () => {
    const d = resolveOccurrenceDetail(stream, null);
    expect(d.hasDetailedBreakdown).toBe(false);
    expect(d.federalWithholding).toBe(111);
    expect(d.additionalTaxReserve).toBe(77);
  });

  it("uses stream values when the override has no detailed breakdown", () => {
    const d = resolveOccurrenceDetail(stream, { action: "modify", has_detailed_breakdown: false, federal_withholding: 999 });
    expect(d.hasDetailedBreakdown).toBe(false);
    expect(d.federalWithholding).toBe(111);
  });

  it("ignores detailed values on a skip override", () => {
    const d = resolveOccurrenceDetail(stream, { ...detailedOverride, action: "skip" });
    expect(d.hasDetailedBreakdown).toBe(false);
    expect(d.federalWithholding).toBe(111);
  });

  it("prefers occurrence detail over the stream when present", () => {
    const d = resolveOccurrenceDetail(stream, detailedOverride);
    expect(d).toMatchObject({
      hasDetailedBreakdown: true,
      federalWithholding: 900,
      stateWithholding: 100,
      ssWithholding: 200,
      medicareWithholding: 50,
      healthcareDeduction: 150,
      hsaContribution: 250,
      additionalTaxReserve: 300,
    });
  });

  it("does not add stream + override values together", () => {
    const d = resolveOccurrenceDetail(stream, detailedOverride);
    expect(d.federalWithholding).not.toBe(111 + 900);
  });
});

/** Mirrors handleConvert's payload construction in ProjectedIncome.tsx. */
function buildConvertPayload(
  entry: { streamId: string; date: string; grossAmount: number; taxesWithheld: number; preTaxDeductions: number; retirement401k: number; healthcareDeduction: number; hsaContribution: number },
  s: ProjectedIncomeStream,
  occOverride?: Partial<ProjectedIncomeOverride> | null,
) {
  const detail = resolveOccurrenceDetail(s, occOverride);
  return {
    grossAmount: entry.grossAmount,
    taxesWithheld: entry.taxesWithheld,
    preTaxDeductions: entry.preTaxDeductions,
    retirement401k: entry.retirement401k,
    healthcareDeduction: entry.healthcareDeduction,
    hsaContribution: entry.hsaContribution,
    federalWithholding: Number(detail.federalWithholding ?? s.federal_withholding ?? 0),
    stateWithholding: Number(detail.stateWithholding ?? s.state_withholding ?? 0),
    ssWithholding: Number(detail.ssWithholding ?? s.ss_withholding ?? 0),
    medicareWithholding: Number(detail.medicareWithholding ?? s.medicare_withholding ?? 0),
    additionalTaxReserve: Number(detail.additionalTaxReserve ?? s.additional_tax_reserve ?? 0),
  };
}

describe("Planner → Personal Income conversion mapping", () => {
  const entry = {
    streamId: "s1",
    date: "2026-03-15",
    grossAmount: 6000,
    taxesWithheld: 1250,
    preTaxDeductions: 100,
    retirement401k: 500,
    healthcareDeduction: 150,
    hsaContribution: 250,
  };

  it("carries detailed values into the ledger fields", () => {
    const payload = buildConvertPayload(entry, stream, detailedOverride);
    expect(payload).toMatchObject({
      federalWithholding: 900,
      stateWithholding: 100,
      ssWithholding: 200,
      medicareWithholding: 50,
      additionalTaxReserve: 300,
      retirement401k: 500,
      healthcareDeduction: 150,
      hsaContribution: 250,
    });
    // Basic total equals the sum of the detailed withholding components.
    expect(payload.taxesWithheld).toBe(
      payload.federalWithholding + payload.stateWithholding + payload.ssWithholding + payload.medicareWithholding,
    );
  });

  it("preserves legacy behavior (stream splits) when no breakdown was entered", () => {
    const payload = buildConvertPayload(entry, stream, null);
    expect(payload).toMatchObject({
      federalWithholding: 111,
      stateWithholding: 22,
      ssWithholding: 33,
      medicareWithholding: 44,
      additionalTaxReserve: 77,
    });
  });

  it("never sends zeroed splits for a stream that has them", () => {
    const payload = buildConvertPayload(entry, stream, { action: "modify", has_detailed_breakdown: false });
    expect(payload.federalWithholding).toBeGreaterThan(0);
    expect(payload.ssWithholding).toBeGreaterThan(0);
  });
});
