import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import {
  generateProjectedPaychecks,
  type ProjectedIncomeStream,
  type MatchableIncomeEntry,
} from "@/hooks/useProjectedIncome";
import { isImportedCashIncomeRow } from "@/hooks/useIncomeMatching";

function makeStream(overrides: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s-hosp",
    user_id: "u1",
    organization_id: null,
    company: "Acme Hospital",
    company_type: "w2",
    pay_frequency: "single",
    custom_interval_days: null,
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: null,
    paycheck_amount: 10000,
    taxes_withheld: 2265,
    retirement_401k: 800,
    pre_tax_deductions: 50,
    is_active: true,
    include_in_tax: true,
    source_id: null,
    ui_income_subtype: null,
    federal_withholding: 1500,
    state_withholding: 0,
    ss_withholding: 620,
    medicare_withholding: 145,
    healthcare_deduction: 300,
    hsa_contribution: 100,
    additional_tax_reserve: 0,
    notes: "",
    forecast_expense_per_period: 0,
    forecast_expense_notes: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const today = format(new Date(), "yyyy-MM-dd");

describe("Bug 1: isImportedCashIncomeRow provenance detection", () => {
  const base = {
    id: "e",
    user_id: "u",
    organization_id: null,
    name: "",
    company: "",
    income_type: "w2",
    income_date: today,
    source_bucket: "personal",
    tax_category: "ordinary",
    is_actual: true,
    include_in_tax_estimate: true,
    include_in_cash_flow: true,
    status: "received",
    created_at: "",
    updated_at: "",
  } as any;

  it("recognizes legacy Plaid rows with default origin_type='manual' as imported", () => {
    const row = {
      ...base,
      origin_type: "manual",
      linked_transaction_id: "tx-1",
      notes: "Imported from Chase (personal account)",
      gross_amount: 6485,
      paycheck_amount: 6485,
      deposited_amount: 6485,
      federal_withholding: 0,
      state_withholding: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
      retirement_401k: 0,
      pre_tax_deductions: 0,
      healthcare_deduction: 0,
      hsa_contribution: 0,
    };
    expect(isImportedCashIncomeRow(row)).toBe(true);
  });

  it("recognizes explicit origin_type='plaid_import' as imported", () => {
    const row = {
      ...base,
      origin_type: "plaid_import",
      gross_amount: 100,
      paycheck_amount: 100,
      deposited_amount: 100,
    };
    expect(isImportedCashIncomeRow(row)).toBe(true);
  });

  it("does NOT flag a real manual payroll row (has withholding) as imported", () => {
    const row = {
      ...base,
      origin_type: "manual",
      gross_amount: 10000,
      paycheck_amount: 10000,
      deposited_amount: 10000,
      federal_withholding: 1500,
      retirement_401k: 800,
      notes: "",
    };
    expect(isImportedCashIncomeRow(row)).toBe(false);
  });

  it("does NOT flag planner_converted rows as imported", () => {
    const row = {
      ...base,
      origin_type: "planner_converted",
      linked_transaction_id: "tx-1",
      notes: "Imported from ...",
      gross_amount: 100,
      deposited_amount: 100,
    };
    expect(isImportedCashIncomeRow(row)).toBe(false);
  });
});

describe("Bug 3: suggested-match compares planned gross to imported net without disqualifying", () => {
  it("suggests a match when source_id agrees even if net deposit (paycheck_amount) is far below planner gross", () => {
    const stream = makeStream({ source_id: "src-hosp" });
    const importedRow: MatchableIncomeEntry = {
      id: "ie-import",
      income_date: today,
      company: "CHASE DIRECT DEP", // bank description, does NOT match "Acme Hospital"
      paycheck_amount: 6485, // net deposit
      income_type: "w2",
      status: "received",
      source_id: "src-hosp", // user linked source
      origin_type: "plaid_import",
      linked_transaction_id: "tx-1",
      notes: "Imported from Chase (personal account)",
      gross_amount: 6485,
      deposited_amount: 6485,
    };
    const result = generateProjectedPaychecks([stream], [], [importedRow], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].matchStatus).toBe("suggested");
    expect(result[0].suggestedIncomeId).toBe("ie-import");
  });

  it("suggests a match when normalized company tokens agree (e.g. 'Acme Hospital' vs 'ACME HOSP PAYROLL')", () => {
    const stream = makeStream({ paycheck_amount: 10000 });
    const importedRow: MatchableIncomeEntry = {
      id: "ie-import-2",
      income_date: today,
      company: "ACME HOSP PAYROLL",
      paycheck_amount: 6485,
      income_type: "w2",
      status: "received",
      origin_type: "plaid_import",
      linked_transaction_id: "tx-2",
      notes: "Imported from Chase",
      gross_amount: 6485,
      deposited_amount: 6485,
    };
    const result = generateProjectedPaychecks([stream], [], [importedRow], [], []);
    expect(result[0].matchStatus).toBe("suggested");
    expect(result[0].suggestedIncomeId).toBe("ie-import-2");
  });

  it("does NOT suggest an unrelated employer's deposit on the same date", () => {
    const stream = makeStream({ source_id: "src-hosp" });
    const unrelated: MatchableIncomeEntry = {
      id: "ie-other",
      income_date: today,
      company: "STARBUCKS COFFEE",
      paycheck_amount: 6485,
      income_type: "w2",
      status: "received",
      source_id: "src-cafe", // different source
      origin_type: "plaid_import",
      linked_transaction_id: "tx-x",
      notes: "Imported from Chase",
      gross_amount: 6485,
      deposited_amount: 6485,
    };
    const result = generateProjectedPaychecks([stream], [], [unrelated], [], []);
    expect(result[0].matchStatus).not.toBe("suggested");
    expect(result[0].suggestedIncomeId).toBeUndefined();
  });
});
