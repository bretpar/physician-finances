/**
 * K-1 Planner employer retirement: separate storage, occurrence overrides,
 * net-cash-only paycheck reduction, and conversion parity (manual vs auto).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildProjectedIncomeStreamInsert,
  generateProjectedPaychecks,
  occurrenceDetailFields,
  type ProjectedIncomeStream,
  type ProjectedIncomeOverride,
} from "@/hooks/useProjectedIncome";
import { buildOccurrenceLedgerFields } from "@/lib/plannerOccurrenceLedger";
import { resolveEmployerPaycheckReduction } from "@/lib/filingTypes";

const year = new Date().getFullYear();
const stream = (over: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream => ({
  id: "s1", user_id: "u", organization_id: null, company: "Vituity", company_type: "k1",
  pay_frequency: "single", custom_interval_days: null, start_date: `${year}-06-15`, end_date: null,
  paycheck_amount: 20_000, taxes_withheld: 0, retirement_401k: 2_000, employer_retirement_contribution: 1_500,
  pre_tax_deductions: 0, is_active: true, include_in_tax: true, source_id: null, ui_income_subtype: "k1_partnership",
  federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0,
  healthcare_deduction: 0, hsa_contribution: 0, additional_tax_reserve: 0, notes: "",
  forecast_expense_per_period: 0, forecast_expense_notes: "", created_at: "", updated_at: "", ...over,
});

describe("K-1 planner employer retirement", () => {
  it("stores employee and employer amounts separately; legacy streams default employer to 0", () => {
    const row = buildProjectedIncomeStreamInsert(stream(), "u", null);
    expect(row.retirement_401k).toBe(2_000);
    expect(row.employer_retirement_contribution).toBe(1_500);
    const legacy = buildProjectedIncomeStreamInsert({ ...stream(), employer_retirement_contribution: undefined }, "u", null);
    expect(legacy.employer_retirement_contribution).toBe(0);
  });

  it("one-time occurrence carries the stream employer amount without reducing net", () => {
    const [p] = generateProjectedPaychecks([stream()], []);
    expect(p.retirement401k).toBe(2_000);
    expect(p.employerRetirementContribution).toBe(1_500);
    expect(p.netAmount).toBe(18_000);
  });

  it("recurring occurrence override owns its employer amount independently of the stream", () => {
    const s = stream({ pay_frequency: "monthly", start_date: `${year}-01-15` });
    const ov = { action: "modify", employer_retirement_contribution: 700 } as Partial<ProjectedIncomeOverride>;
    expect(occurrenceDetailFields(s, ov).employerRetirementContribution).toBe(700);
    expect(occurrenceDetailFields(s, null).employerRetirementContribution).toBe(1_500);
  });

  it("conversion ledger fields keep employee/employer separate and gross intact", () => {
    const f = buildOccurrenceLedgerFields({
      grossAmount: 20_000, taxesWithheld: 0, retirement401k: 2_000, employerRetirementContribution: 1_500,
      preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0,
    });
    expect(f.gross_amount).toBe(20_000);
    expect(f.retirement_401k).toBe(2_000);
    expect(f.employer_retirement_contribution).toBe(1_500);
    expect(f.deposited_amount).toBe(18_000);
  });

  it("paycheck-reduction toggle only applies when the employer field is enabled", () => {
    expect(resolveEmployerPaycheckReduction("k1_partnership", {
      employer_retirement_contribution: true, employer_retirement_reduces_paycheck: true,
    }).retirement).toBe(true);
    expect(resolveEmployerPaycheckReduction("k1_partnership", {
      employer_retirement_contribution: true, employer_retirement_reduces_paycheck: false,
    }).retirement).toBe(false);
  });

  it("automatic business conversion reuses the shared linked income-entry mirror", () => {
    const src = readFileSync("src/lib/plannerConversion.ts", "utf8");
    const hook = readFileSync("src/hooks/useProjectedIncome.ts", "utf8");
    expect(src).toContain("upsertBusinessIncomeMirror(");
    expect(hook.match(/upsertBusinessIncomeMirror\(\{/g)?.length).toBe(1); // manual path
    // Mirror lookup by linked transaction id prevents a duplicate on retry.
    expect(hook).toMatch(/upsertBusinessIncomeMirror[\s\S]*?\.eq\("linked_transaction_id", args\.txId\)/);
  });
});
