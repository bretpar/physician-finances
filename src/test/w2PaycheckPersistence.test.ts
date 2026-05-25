import { describe, it, expect } from "vitest";
import { buildIncomeEntryRow } from "@/hooks/usePersonalIncome";

// Full "complex W-2" sample with non-trivial cents on every field. The audit
// flagged a high-severity persistence mismatch where the insert path silently
// dropped several fields (additional_tax_reserve, base/dynamic/quarterly tax
// recommendations, recommendation_status) and used `||` fallbacks that turned
// an explicit $0 into either a default or another field's value.
const W2_PAYLOAD = {
  name: "Providence Biweekly #11",
  company: "Providence",
  source_id: "11111111-1111-1111-1111-111111111111",
  income_type: "w2_user",
  ui_income_subtype: "w2_user",
  income_date: "2026-05-22",
  gross_amount: 8421.57,
  paycheck_amount: 8421.57,
  deposited_amount: 5123.91,
  federal_withholding: 1284.33,
  state_withholding: 412.07,
  ss_withholding: 522.14,
  medicare_withholding: 122.11,
  taxes_withheld: 1284.33 + 522.14 + 122.11, // canonical total
  retirement_401k: 750.0,
  pre_tax_deductions: 25.5,
  healthcare_deduction: 187.42,
  hsa_contribution: 250.55,
  additional_tax_reserve: 333.33,
  base_tax_estimate: 1500.5,
  dynamic_tax_recommendation: 1620.75,
  quarterly_adjustment_amount: 120.25,
  recommendation_status: "behind",
  tax_category: "ordinary",
  notes: "Full W-2 round-trip",
  status: "received",
} as const;

describe("W-2 paycheck persistence — lossless round-trip", () => {
  it("preserves every W-2 field 1:1 on insert", () => {
    const row = buildIncomeEntryRow(W2_PAYLOAD);
    for (const key of Object.keys(W2_PAYLOAD) as (keyof typeof W2_PAYLOAD)[]) {
      // income_type is canonicalized (w2_user → w2); compare ui_income_subtype instead.
      if (key === "income_type") {
        expect(row.income_type).toBe("w2");
        continue;
      }
      expect((row as any)[key]).toBe(W2_PAYLOAD[key]);
    }
  });

  it("preserves explicit $0 for every money field (no || fallback)", () => {
    const row = buildIncomeEntryRow({
      ...W2_PAYLOAD,
      // Zero out every money field — a previous bug substituted gross_amount
      // for paycheck_amount and federal_withholding for taxes_withheld.
      paycheck_amount: 0,
      deposited_amount: 0,
      federal_withholding: 0,
      state_withholding: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
      taxes_withheld: 0,
      retirement_401k: 0,
      pre_tax_deductions: 0,
      healthcare_deduction: 0,
      hsa_contribution: 0,
      additional_tax_reserve: 0,
    });
    expect(row.paycheck_amount).toBe(0);
    expect(row.deposited_amount).toBe(0);
    expect(row.federal_withholding).toBe(0);
    expect(row.state_withholding).toBe(0);
    expect(row.ss_withholding).toBe(0);
    expect(row.medicare_withholding).toBe(0);
    expect(row.taxes_withheld).toBe(0);
    expect(row.retirement_401k).toBe(0);
    expect(row.pre_tax_deductions).toBe(0);
    expect(row.healthcare_deduction).toBe(0);
    expect(row.hsa_contribution).toBe(0);
    expect(row.additional_tax_reserve).toBe(0);
    // Gross is the one field that must remain non-zero for the row to make
    // sense, so the form-level validation blocks save when gross is 0. The
    // row builder still echoes the value verbatim.
    expect(row.gross_amount).toBe(W2_PAYLOAD.gross_amount);
  });

  it("preserves cents (no silent rounding) across the full dataset", () => {
    const row = buildIncomeEntryRow(W2_PAYLOAD);
    // Sum the W-2 federal payroll components and confirm cent-level integrity.
    const componentSum = row.federal_withholding + row.ss_withholding + row.medicare_withholding;
    expect(Math.round(componentSum * 100)).toBe(
      Math.round((W2_PAYLOAD.federal_withholding + W2_PAYLOAD.ss_withholding + W2_PAYLOAD.medicare_withholding) * 100),
    );
    expect(row.hsa_contribution).toBe(250.55);
    expect(row.healthcare_deduction).toBe(187.42);
    expect(row.additional_tax_reserve).toBe(333.33);
  });

  it("does NOT drop optional tax-recommendation fields on first save", () => {
    const row = buildIncomeEntryRow(W2_PAYLOAD) as Record<string, unknown>;
    // These are the exact fields that were silently dropped by the previous
    // insert path. If any of these regresses, downstream Tax Overview falls
    // back to stale onboarding defaults — high-severity audit finding.
    for (const key of [
      "additional_tax_reserve",
      "base_tax_estimate",
      "dynamic_tax_recommendation",
      "quarterly_adjustment_amount",
      "recommendation_status",
    ]) {
      expect(row, `missing field on insert payload: ${key}`).toHaveProperty(key);
    }
  });
});
