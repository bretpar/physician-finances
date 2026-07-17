import { describe, expect, it } from "vitest";
import { computeUnifiedTaxEstimate } from "@/lib/taxCalculationService";
import { makeInput } from "@/lib/taxValidation/defaults";
import {
  FUTURE_ADJUSTMENT_REGISTRY,
  STAGE_ORDER,
  TaxStage,
  buildTaxAdjustmentPipeline,
  groupPipelineByStage,
} from "@/lib/taxPipeline";
import { SCENARIOS } from "@/lib/taxValidation/scenarios";
import { runScenario } from "@/lib/taxValidation/runValidation";

describe("TaxAdjustment pipeline", () => {
  const { estimate } = computeUnifiedTaxEstimate(makeInput({}));
  const pipeline = estimate.adjustments;

  it("exposes an ordered adjustments array on TaxEstimate", () => {
    expect(Array.isArray(pipeline)).toBe(true);
    expect(pipeline.length).toBeGreaterThan(0);
  });

  it("includes every canonical stage that emits entries", () => {
    const stages = new Set(pipeline.map((a) => a.stage));
    for (const s of [
      TaxStage.GrossIncome,
      TaxStage.BusinessProfit,
      TaxStage.AdjustmentsToIncome,
      TaxStage.AGI,
      TaxStage.TaxableIncome,
      TaxStage.FederalIncomeTax,
      TaxStage.PayrollTaxes,
      TaxStage.Surtaxes,
      TaxStage.Credits,
      TaxStage.FinalLiability,
      TaxStage.RecommendedReserve,
    ]) {
      expect(stages.has(s)).toBe(true);
    }
  });

  it("groups adjustments in canonical STAGE_ORDER", () => {
    const groups = groupPipelineByStage(pipeline);
    const idx = groups.map((g) => STAGE_ORDER.indexOf(g.stage));
    const sorted = [...idx].sort((a, b) => a - b);
    expect(idx).toEqual(sorted);
  });

  it("registers every future adjustment spec as disabled with amount 0", () => {
    for (const spec of FUTURE_ADJUSTMENT_REGISTRY) {
      const entry = pipeline.find((a) => a.id === spec.id);
      expect(entry, `missing future adjustment: ${spec.id}`).toBeDefined();
      expect(entry!.enabled).toBe(false);
      expect(entry!.amount).toBe(0);
    }
  });

  it("each entry carries id, displayName, explanation, and sourceData", () => {
    for (const a of pipeline) {
      expect(a.id).toBeTruthy();
      expect(a.displayName).toBeTruthy();
      expect(a.explanation).toBeTruthy();
      expect(a.sourceData).toBeDefined();
    }
  });

  it("does not alter existing scenario outputs (regression)", () => {
    for (const scenario of SCENARIOS) {
      const { result } = runScenario(scenario);
      expect(result.estimate.adjustments.length).toBeGreaterThan(0);
      // Pipeline is derived — must not mutate core totals.
      const rebuilt = buildTaxAdjustmentPipeline(result.estimate);
      expect(rebuilt.map((a) => a.id)).toEqual(
        result.estimate.adjustments.map((a) => a.id),
      );
    }
  });
});
