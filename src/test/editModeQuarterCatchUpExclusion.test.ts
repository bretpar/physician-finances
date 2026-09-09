/**
 * Regression: editing an existing 1099 income entry must use replacement
 * semantics in the quarterly catch-up context.
 *
 * Production bug: gross $10,080, employer Solo 401(k) $1,000.
 * Pre-save recommendation $7,980.79; after save/reopen it became $9,021.73
 * (+$1,040.94) because the quarter progress context still contained the saved
 * income entry (its reserve, withholding, and prior dynamic_tax_recommendation)
 * while the draft was priced again on top of it.
 *
 * The fix threads `excludeTransactionId` into `useQuarterRecommendationInput`,
 * which filters the edited transaction and every income entry linked to it
 * (via `excludeIncomeEntriesLinkedToTransaction`) before the catch-up math
 * runs. This test exercises the same helpers the hook applies.
 */
import { describe, it, expect } from "vitest";
import {
  excludeIncomeTransactionFromTaxContext,
  excludeIncomeEntriesLinkedToTransaction,
} from "@/lib/taxRecommendationContext";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const TX_ID = "edit-1099-tx";

/** The saved 1099 event being reopened for editing. */
const saved1099Entry = {
  id: "edit-1099-entry",
  linked_transaction_id: TX_ID,
  income_date: "2026-08-14",
  income_type: "1099",
  paycheck_amount: 10_080,
  employer_retirement_contribution: 1_000,
  additional_tax_reserve: 7_980.79,
  dynamic_tax_recommendation: 7_980.79,
  federal_withholding: 0,
  include_in_tax_estimate: true,
};
const saved1099Tx = {
  id: TX_ID,
  amount: 10_080,
  transaction_type: "income",
  transaction_date: "2026-08-14",
  actual_withholding: 0,
};
/** An unrelated prior event that must remain in context. */
const priorEntry = {
  id: "prior-entry",
  linked_transaction_id: "prior-tx",
  income_date: "2026-07-10",
  income_type: "1099",
  paycheck_amount: 5_000,
  additional_tax_reserve: 2_000,
  dynamic_tax_recommendation: 2_000,
  federal_withholding: 0,
};
const priorTx = {
  id: "prior-tx",
  amount: 5_000,
  transaction_type: "income",
  transaction_date: "2026-07-10",
  actual_withholding: 0,
};

function quarterInputFor(transactions: any[], incomeEntries: any[]) {
  return {
    year: 2026,
    quarter: 3 as const,
    annualTaxLiability: 40_000,
    federalIncomeTax: 32_000,
    selfEmploymentTax: 8_000,
    quarterMethod: "even" as const,
    incomeEntries,
    personalEntries: [],
    transactions,
    investmentEntries: [],
    projectedPaychecks: [],
    payments: [],
    manualSavings: [],
    now: new Date(2026, 7, 20),
  };
}

describe("edit-mode quarterly catch-up exclusion", () => {
  it("create mode (no exclusion) keeps the full context unchanged", () => {
    const txs = [priorTx, saved1099Tx];
    const entries = [priorEntry, saved1099Entry];
    const scoped = excludeIncomeTransactionFromTaxContext(txs, entries, null);
    expect(scoped.transactions).toHaveLength(2);
    expect(scoped.incomeEntries).toHaveLength(2);
    expect(excludeIncomeEntriesLinkedToTransaction(entries, null)).toHaveLength(2);
  });

  it("edit mode removes the saved transaction and its linked income entry", () => {
    const scoped = excludeIncomeTransactionFromTaxContext([priorTx, saved1099Tx], [priorEntry, saved1099Entry], TX_ID);
    expect(scoped.transactions.map((t) => t.id)).toEqual(["prior-tx"]);
    expect(scoped.incomeEntries.map((e) => e.id)).toEqual(["prior-entry"]);
    // The entry's reserve and prior dynamic_tax_recommendation leave with it.
    expect(scoped.incomeEntries[0].additional_tax_reserve).toBe(2_000);
  });

  it("excluded edit context produces a lower progress amount than the leaked context", () => {
    const leaked = buildQuarterRecommendation(
      quarterInputFor([priorTx, saved1099Tx], [priorEntry, saved1099Entry]),
    );
    const scoped = excludeIncomeTransactionFromTaxContext([priorTx, saved1099Tx], [priorEntry, saved1099Entry], TX_ID);
    const fixed = buildQuarterRecommendation(
      quarterInputFor(scoped.transactions, scoped.incomeEntries),
    );
    // The saved event's $7,980.79 reserve no longer counts toward Saved.
    expect(fixed.progressAmount).toBeLessThan(leaked.progressAmount);
    expect(leaked.progressAmount - fixed.progressAmount).toBeCloseTo(7_980.79, 2);
  });

  it("excluded edit context matches the pre-save (create) context for the same values", () => {
    // Pre-save: the transaction/entry do not exist yet.
    const preSave = buildQuarterRecommendation(quarterInputFor([priorTx], [priorEntry]));
    // Post-save reopen with the exclusion applied.
    const scoped = excludeIncomeTransactionFromTaxContext([priorTx, saved1099Tx], [priorEntry, saved1099Entry], TX_ID);
    const reopen = buildQuarterRecommendation(
      quarterInputFor(scoped.transactions, scoped.incomeEntries),
    );
    expect(reopen.progressAmount).toBe(preSave.progressAmount);
    expect(reopen.quarterTarget).toBe(preSave.quarterTarget);
  });
});
