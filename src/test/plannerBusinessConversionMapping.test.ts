import { describe, it, expect } from "vitest";
import {
  buildOccurrenceLedgerFields,
  pickExistingBankTransactionId,
} from "@/lib/plannerOccurrenceLedger";

/**
 * Regression: Planner → Business Activity conversion must split the planner's
 * AGGREGATE pre-tax amount into Health Insurance / HSA / Other Pre-Tax exactly
 * once, and must reuse an existing bank transaction instead of creating a
 * duplicate "Planner" row.
 */
describe("Planner → Business Activity deduction mapping", () => {
  it("resolves the production K-1 case to $7,662 Net Received (no double count)", () => {
    const f = buildOccurrenceLedgerFields({
      grossAmount: 10675,
      taxesWithheld: 0,
      retirement401k: 320,
      preTaxDeductions: 2693, // aggregate: health 2493 + HSA 200
      healthcareDeduction: 2493,
      hsaContribution: 200,
      hasDetailedBreakdown: true,
    });
    expect(f.healthcare_deduction).toBe(2493);
    expect(f.hsa_contribution).toBe(200);
    expect(f.pre_tax_deductions).toBe(0);
    expect(f.deposited_amount).toBe(7662);
  });

  it("healthcare-only aggregate leaves Other Pre-Tax at zero", () => {
    const f = buildOccurrenceLedgerFields({
      grossAmount: 5000,
      taxesWithheld: 0,
      retirement401k: 0,
      preTaxDeductions: 400,
      healthcareDeduction: 400,
      hsaContribution: 0,
      hasDetailedBreakdown: true,
    });
    expect(f.pre_tax_deductions).toBe(0);
    expect(f.deposited_amount).toBe(4600);
  });

  it("mixed deductions keep each component once and sum to the aggregate", () => {
    const f = buildOccurrenceLedgerFields({
      grossAmount: 9000,
      taxesWithheld: 1000,
      retirement401k: 500,
      preTaxDeductions: 800, // health 300 + HSA 200 + other 300
      healthcareDeduction: 300,
      hsaContribution: 200,
      hasDetailedBreakdown: true,
    });
    expect(f.pre_tax_deductions).toBe(300);
    expect(
      f.healthcare_deduction + f.hsa_contribution + f.pre_tax_deductions,
    ).toBe(800);
    expect(f.deposited_amount).toBe(9000 - 1000 - 500 - 800);
  });

  it("clamps Other Pre-Tax at zero when components exceed the aggregate", () => {
    const f = buildOccurrenceLedgerFields({
      grossAmount: 4000,
      taxesWithheld: 0,
      retirement401k: 0,
      preTaxDeductions: 100,
      healthcareDeduction: 500,
      hsaContribution: 0,
      hasDetailedBreakdown: true,
    });
    expect(f.pre_tax_deductions).toBe(0);
  });

  it("passes stream-level (non-detailed) pre-tax through unchanged", () => {
    const f = buildOccurrenceLedgerFields({
      grossAmount: 4000,
      taxesWithheld: 0,
      retirement401k: 0,
      preTaxDeductions: 100,
      healthcareDeduction: 200,
      hsaContribution: 0,
      hasDetailedBreakdown: false,
    });
    expect(f.pre_tax_deductions).toBe(100);
    expect(f.deposited_amount).toBe(4000 - 100 - 200);
  });
});

describe("bank match preservation", () => {
  const occ = {
    matchStatus: "suggested" as string,
    suggestedTransactionId: "tx-1",
    suggestedBucket: "business" as const,
  };

  it("reuses a suggested business bank transaction", () => {
    expect(pickExistingBankTransactionId(occ, "business")).toBe("tx-1");
  });

  it("reuses a confirmed matched business transaction", () => {
    expect(
      pickExistingBankTransactionId(
        { matchStatus: "matched", matchedIncomeId: "tx-9" },
        "business",
      ),
    ).toBe("tx-9");
  });

  it("never reuses ids for the personal bucket", () => {
    expect(pickExistingBankTransactionId(occ, "personal")).toBeNull();
    expect(
      pickExistingBankTransactionId(
        { matchStatus: "matched", matchedIncomeId: "ie-1" },
        "personal",
      ),
    ).toBeNull();
  });

  it("creates a fresh planner row for unmatched occurrences", () => {
    expect(pickExistingBankTransactionId({ matchStatus: "active" }, "business")).toBeNull();
    expect(pickExistingBankTransactionId({ matchStatus: "past_due" }, "business")).toBeNull();
  });

  it("ignores a personal-bucket suggestion on a business conversion", () => {
    expect(
      pickExistingBankTransactionId(
        { matchStatus: "suggested", suggestedIncomeId: "ie-2", suggestedBucket: "personal" } as any,
        "business",
      ),
    ).toBeNull();
  });
});
