// Barrel + dev-only global hook.
// When `debug:taxEngine` is enabled, expose helpers on window so devs
// can run the suite from the browser console without navigating.

import { runAllScenarios } from "./runValidation";
import { verifyPageConsistency } from "./pageConsistency";

export * from "./scenarios";
export * from "./runValidation";
export * from "./pageConsistency";
export {
  TaxStage,
  STAGE_ORDER,
  STAGE_LABELS,
  FUTURE_ADJUSTMENT_REGISTRY,
  buildTaxAdjustmentPipeline,
  groupPipelineByStage,
  type TaxAdjustment,
  type FutureAdjustmentSpec,
} from "@/lib/taxPipeline";

if (typeof window !== "undefined") {
  try {
    const enabled = window.localStorage.getItem("debug:taxEngine") === "1";
    if (enabled) {
      (window as unknown as Record<string, unknown>).__taxValidation = {
        runAllScenarios,
        verifyPageConsistency,
      };
    }
  } catch {
    // no-op: private mode or SSR
  }
}
