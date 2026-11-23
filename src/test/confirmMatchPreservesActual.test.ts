import { describe, it, expect } from "vitest";
import { buildConfirmMatchPatch } from "@/lib/confirmMatchPatch";

const FINANCIAL = ["gross_amount","paycheck_amount","deposited_amount","federal_withholding","state_withholding","ss_withholding","medicare_withholding","taxes_withheld","retirement_401k","employer_retirement_contribution","healthcare_deduction","hsa_contribution","pre_tax_deductions","fsa_health","fsa_dependent_care","fsa_limited_purpose","additional_tax_reserve","company","income_date","notes","tax_category"];
const planner = { gross_amount: 5000, paycheck_amount: 5000, retirement_401k: 100, federal_withholding: 0, ss_withholding: 0, medicare_withholding: 0, taxes_withheld: 0, pre_tax_deductions: 0, fsa_health: 0, fsa_dependent_care: 0, fsa_limited_purpose: 0, healthcare_deduction: 0, hsa_contribution: 0, state_withholding: 0, additional_tax_reserve: 0 };
const stream = { company: "Optum", source_id: "co1", ui_income_subtype: "w2" };
const manual = { id: "ie1", company: "Optum", source_id: "co1", ui_income_subtype: "w2", origin_type: "manual", income_date: "2026-11-14", notes: "",
  gross_amount: 5000, paycheck_amount: 5000, deposited_amount: 3294.27, retirement_401k: 500, federal_withholding: 475, ss_withholding: 288.3, medicare_withholding: 67.43,
  taxes_withheld: 830.73, state_withholding: 0, pre_tax_deductions: 375, employer_retirement_contribution: 0, healthcare_deduction: 0, hsa_contribution: 0,
  fsa_health: 0, fsa_dependent_care: 0, fsa_limited_purpose: 0, additional_tax_reserve: 0, tax_category: "w2" };
const apply = (row: any) => ({ ...row, ...buildConfirmMatchPatch({ existing: row, conversionId: "conv1", plannerFields: planner, stream }) });

describe("suggested-match confirmation", () => {
  it("keeps every saved value of the $5,000 manual paycheck and adds lineage", () => {
    const after = apply(manual);
    for (const k of FINANCIAL) expect(after[k]).toEqual((manual as any)[k]);
    expect(after.id).toBe("ie1");
    expect(after.origin_planner_conversion_id).toBe("conv1");
    expect(after.origin_type).toBe("planner_converted");
  });
  it("keeps intentional zeros on a saved actual paycheck", () => {
    const zero = { ...manual, retirement_401k: 0, federal_withholding: 0, pre_tax_deductions: 0 };
    const p = buildConfirmMatchPatch({ existing: zero, conversionId: "c", plannerFields: { ...planner, retirement_401k: 400, federal_withholding: 600 }, stream });
    expect(p.retirement_401k).toBeUndefined();
    expect(p.federal_withholding).toBeUndefined();
  });
  it("still enriches a raw bank-import-only row", () => {
    const raw = { id: "ie2", company: "", origin_type: "plaid_import", deposited_amount: 3294.27, linked_transaction_id: "t1", notes: "Imported from Chase" };
    const after = apply(raw);
    expect(after.federal_withholding).toBe(0);
    expect(after.retirement_401k).toBe(100);
    expect(after.gross_amount).toBe(5000);
    expect(after.deposited_amount).toBe(3294.27);
    expect(after.company).toBe("Optum");
  });
  it("repeated confirmation is idempotent", () => {
    const once = apply(manual);
    const twice = apply(once);
    expect(twice).toEqual(once);
  });
});
