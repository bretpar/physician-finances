/**
 * Regression: initial W-2 paycheck creation dropped employer_hsa_contribution.
 *
 * Root cause: `buildIncomeEntryRow` (usePersonalIncome.ts) built the canonical
 * insert row by enumerating fields explicitly and omitted
 * `employer_hsa_contribution`. The edit path spreads `updates` directly, so
 * only create was broken — reproducing the reported create-vs-edit asymmetry.
 *
 * These tests pin the canonical row shape so the field cannot regress again.
 */
import { describe, it, expect } from "vitest";
import { buildIncomeEntryRow } from "@/hooks/usePersonalIncome";

describe("buildIncomeEntryRow — employer HSA persistence on create", () => {
  it("A. persists both employee ($3,000) and employer ($2,000) HSA on initial create", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 100_000,
      hsa_contribution: 3_000,
      employer_hsa_contribution: 2_000,
    } as any);
    expect(row.hsa_contribution).toBe(3_000);
    expect((row as any).employer_hsa_contribution).toBe(2_000);
  });

  it("B. persists employer-only HSA ($2,000 employer, $0 employee)", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 100_000,
      hsa_contribution: 0,
      employer_hsa_contribution: 2_000,
    } as any);
    expect(row.hsa_contribution).toBe(0);
    expect((row as any).employer_hsa_contribution).toBe(2_000);
  });

  it("C. persists employee-only HSA ($3,000 employee, $0 employer)", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 100_000,
      hsa_contribution: 3_000,
      employer_hsa_contribution: 0,
    } as any);
    expect(row.hsa_contribution).toBe(3_000);
    expect((row as any).employer_hsa_contribution).toBe(0);
  });

  it("D. zero for both when neither is provided", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 100_000,
    } as any);
    expect(row.hsa_contribution).toBe(0);
    expect((row as any).employer_hsa_contribution).toBe(0);
  });

  it("preserves employer HSA under money() coercion (string input from form)", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 100_000,
      hsa_contribution: "3000" as any,
      employer_hsa_contribution: "2000" as any,
    } as any);
    expect((row as any).employer_hsa_contribution).toBe(2_000);
  });

  it("canonical row shape exposes employer_hsa_contribution as an own property", () => {
    // Guards against future accidental removal — a missing key would let the
    // DB default silently win on insert (the exact production defect).
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 100_000,
      employer_hsa_contribution: 1_500,
    } as any);
    expect(Object.prototype.hasOwnProperty.call(row, "employer_hsa_contribution")).toBe(true);
  });
});
