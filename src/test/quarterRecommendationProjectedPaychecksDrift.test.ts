import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

/**
 * Regression test for the historical $251 Dashboard vs Tax Overview drift.
 *
 * Root cause: each screen built `projectedPaychecks` from a different set
 * of arguments. Dashboard included overrides + planner conversions +
 * business income txs; Taxes called `generateProjectedPaychecks` with
 * only (streams, bonuses, incomeEntries). In `quarterMethod="dynamic"`
 * that difference flows into `quarterTarget` and therefore into
 * `recommendedPaymentToMake`.
 *
 * This test pins the failure mode: when two callers pass different
 * `projectedPaychecks`, the helper returns different quarterTargets — so
 * the only safe fix is to share the input via `useQuarterRecommendationInput`.
 */
describe("buildQuarterRecommendation — projectedPaychecks drift", () => {
  const YEAR = 2026;
  const TODAY = new Date(YEAR, 5, 9, 12, 0, 0);

  const base = {
    annualTaxLiability: 60_000,
    year: YEAR,
    quarter: 2 as const,
    quarterMethod: "dynamic" as const,
    incomeEntries: [],
    personalEntries: [],
    transactions: [],
    investmentEntries: [],
    payments: [],
    manualSavings: [],
    now: TODAY,
  };

  // Dashboard-style: full-fidelity projected paychecks include a future Q2
  // paycheck that was already converted/skipped in the planner.
  const dashboardPaychecks = [
    { date: `${YEAR}-04-15`, grossAmount: 25_000 },
    { date: `${YEAR}-05-15`, grossAmount: 25_000 },
  ];
  // Taxes-style (old): omitted overrides so an extra paycheck shows up.
  const taxesPaychecks = [
    { date: `${YEAR}-04-15`, grossAmount: 25_000 },
    { date: `${YEAR}-05-15`, grossAmount: 25_000 },
    { date: `${YEAR}-05-29`, grossAmount: 25_000 }, // duplicated/unfiltered
  ];

  it("different projectedPaychecks produce different quarterTargets (the historical drift)", () => {
    const a = buildQuarterRecommendation({ ...base, projectedPaychecks: dashboardPaychecks });
    const b = buildQuarterRecommendation({ ...base, projectedPaychecks: taxesPaychecks });
    expect(a.quarterTarget).not.toBe(b.quarterTarget);
    expect(a.recommendedPaymentToMake).not.toBe(b.recommendedPaymentToMake);
  });

  it("identical projectedPaychecks (shared input) produce identical recommendedPaymentToMake", () => {
    const a = buildQuarterRecommendation({ ...base, projectedPaychecks: dashboardPaychecks });
    const b = buildQuarterRecommendation({ ...base, projectedPaychecks: dashboardPaychecks });
    expect(a.quarterTarget).toBe(b.quarterTarget);
    expect(a.paidThisQuarter).toBe(b.paidThisQuarter);
    expect(a.recommendedPaymentToMake).toBe(b.recommendedPaymentToMake);
  });
});
