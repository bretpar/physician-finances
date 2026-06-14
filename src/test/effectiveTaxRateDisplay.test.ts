import { describe, it, expect } from "vitest";
import { getDisplayedEffectiveRatePct } from "@/lib/effectiveTaxRateDisplay";
import type { TaxEstimate } from "@/lib/taxEngine";

const baseEstimate = (over: Partial<TaxEstimate> = {}): TaxEstimate =>
  ({
    totalIncome: 200000,
    totalReturnIncomeBeforeAdjustments: 200000,
    totalTaxLiability: 30000,
    federalTax: 24000,
    personalStateTax: 0,
    effectiveRate: 15,
    federalEffectiveRate: 12,
    w2Income: 200000,
    seIncome: 0,
    ...over,
  }) as unknown as TaxEstimate;

describe("getDisplayedEffectiveRatePct", () => {
  it("matches between actual and forecast when given the mode-correct estimate", () => {
    const actual = baseEstimate({ effectiveRate: 14.6 });
    const forecast = baseEstimate({ effectiveRate: 22.1 });
    const settings = { withholdingMethod: "dynamic_planner" } as any;

    const overview = getDisplayedEffectiveRatePct({
      taxSettings: settings,
      modeEstimate: actual,
      actualEstimate: actual,
      forecastEstimate: forecast,
    });
    const breakdown = getDisplayedEffectiveRatePct({
      taxSettings: settings,
      modeEstimate: actual,
      actualEstimate: actual,
      forecastEstimate: forecast,
    });
    expect(overview).toBeCloseTo(14.6, 1);
    expect(overview).toBe(breakdown);
  });

  it("uses flat profile rate when withholdingMethod is flat_estimate", () => {
    const e = baseEstimate({ effectiveRate: 14.6 });
    const settings = { withholdingMethod: "flat_estimate", manualEffectiveTaxRate: 25 } as any;
    const r = getDisplayedEffectiveRatePct({
      taxSettings: settings,
      modeEstimate: e,
      actualEstimate: e,
      forecastEstimate: e,
    });
    expect(r).toBe(25);
  });
});
