// ============================================================================
// usePageTaxConsumer — dev-only page registration helper
// ============================================================================
// Zero cost in production. When `debug:taxEngine=1`, this registers the
// page with the canonical scope so the Tax Validation Suite's page
// consistency report can verify every major page consumes the same
// TaxEstimate identity.
//
// Usage (top of page component, after useTaxEstimate):
//   usePageTaxConsumer("Dashboard", actualDebug);
// ============================================================================

import { useEffect } from "react";
import {
  registerTaxEstimateConsumer,
  type TaxScope,
} from "@/lib/taxEngineDiagnostics";
import type { TaxDebugBreakdown } from "@/lib/taxCalculationService";

export function usePageTaxConsumer(
  pageName: string,
  debug: TaxDebugBreakdown | null,
  scope: TaxScope = "actual",
): void {
  useEffect(() => {
    if (!debug) return;
    registerTaxEstimateConsumer(pageName, scope, debug);
  }, [pageName, debug, scope]);
}
