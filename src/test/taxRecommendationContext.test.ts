import { describe, expect, it } from "vitest";
import { excludeIncomeTransactionFromTaxContext } from "@/lib/taxRecommendationContext";
import { getSavingsRateForIncomeBucket } from "@/lib/savingsRateSelection";

const currentId = "current-income";
const priorTransaction = { id: "prior-income", amount: 40_000 };
const currentTransaction = { id: currentId, amount: 10_000 };
const currentEntry = {
  id: "current-entry",
  linked_transaction_id: currentId,
  retirement_401k: 500,
  hsa_contribution: 200,
};

function recommendationRate(existingBusinessIncome: number) {
  const estimate = {
    federalEffectiveRate: 14.2,
    effectiveRate: 18,
    federalTax: 7_100,
    totalTaxLiability: 9_000,
    totalIncome: 50_000,
    totalReturnIncomeBeforeAdjustments: 50_000,
    taxableIncome: 35_000,
    w2Income: 0,
    seIncome: existingBusinessIncome,
    seTax: { total: 0 },
  } as any;

  return getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "k1_partnership",
    taxSettings: { withholdingMethod: "dynamic_actual" },
    actualEstimate: estimate,
    forecastEstimate: null,
    currentNetSEIncome: existingBusinessIncome,
    entryGrossAmount: 9_300,
    entryNetSEIncome: 10_000,
  }).rate;
}

describe("income recommendation replacement context", () => {
  it("gives unsaved, immediately persisted, and reopened Edit equivalent context", () => {
    const unsaved = excludeIncomeTransactionFromTaxContext([priorTransaction], [], null);
    const persisted = excludeIncomeTransactionFromTaxContext(
      [priorTransaction, currentTransaction],
      [currentEntry],
      currentId,
    );
    const reopened = excludeIncomeTransactionFromTaxContext(
      [priorTransaction, currentTransaction],
      [currentEntry],
      currentId,
    );

    expect(persisted).toEqual(unsaved);
    expect(reopened).toEqual(unsaved);

    const unsavedGross = unsaved.transactions.reduce((sum, row) => sum + row.amount, 0);
    const persistedGross = persisted.transactions.reduce((sum, row) => sum + row.amount, 0);
    expect(recommendationRate(persistedGross)).toBe(recommendationRate(unsavedGross));
  });

  it("excludes current gross and employee deductions before applying the draft", () => {
    const context = excludeIncomeTransactionFromTaxContext(
      [priorTransaction, currentTransaction],
      [
        { id: "prior-entry", linked_transaction_id: priorTransaction.id, retirement_401k: 0, hsa_contribution: 0 },
        currentEntry,
      ],
      currentId,
    );

    expect(context.transactions.map((row) => row.id)).toEqual([priorTransaction.id]);
    expect(context.incomeEntries.map((row) => row.id)).toEqual(["prior-entry"]);
  });

  it("does not mutate source rows needed for Planner conversion matching", () => {
    const transactions = [priorTransaction, currentTransaction];
    excludeIncomeTransactionFromTaxContext(transactions, [currentEntry], currentId);
    expect(transactions.map((row) => row.id)).toEqual([priorTransaction.id, currentId]);
  });
});