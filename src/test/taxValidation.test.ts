import { describe, expect, it } from "vitest";
import { runAllScenarios, SCENARIOS } from "@/lib/taxValidation";

describe("Tax Engine Validation Suite — regression baseline", () => {
  const summary = runAllScenarios();

  it("has a baseline entry for every scenario", () => {
    expect(summary.missingBaseline).toBe(0);
  });

  for (const report of summary.reports) {
    it(`${report.scenario.id} — ${report.scenario.name}`, () => {
      if (report.status === "FAIL") {
        // eslint-disable-next-line no-console
        console.error(
          `Scenario ${report.scenario.id} drift:`,
          report.failedFields.map((f) => ({
            field: f.field,
            expected: f.expected,
            actual: f.actual,
            delta: f.difference,
            pctDelta: f.percentDifference,
          })),
        );
      }
      expect(report.status).toBe("PASS");
    });
  }

  it("covers all required categories", () => {
    const categories = new Set(SCENARIOS.map((s) => s.category));
    for (const c of [
      "w2_only",
      "1099_only",
      "mixed",
      "multi_business",
      "capital_gains",
      "high_income",
      "low_income",
      "negative_profit",
    ]) {
      expect(categories.has(c as typeof SCENARIOS[number]["category"])).toBe(true);
    }
  });
});
