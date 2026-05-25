/**
 * Canonical withholding selector — SINGLE SOURCE OF TRUTH.
 *
 * Returns the total federal/state withholding figures used across:
 *   • Paychecks summary (Personal Income → "Total Withheld" stat)
 *   • Withholding Guide (Projected Income page YTD chips & projection math)
 *   • Tax Overview (Taxes.tsx debug breakdown)
 *
 * All callers MUST consume this selector. Page-specific aggregation of
 * `federal_withholding`, `taxes_withheld`, or YTD catch-up rows is forbidden
 * because it caused the audit-reported $20,120 vs $14,000 drift.
 *
 * The numbers are derived from the unified tax engine
 * (`useTaxEstimate` → debug breakdown) which already:
 *   1. Uses `getTotalFederalPaid()` (legacy + canonical row precedence).
 *   2. Subtracts YTD catch-up overlap with imported paychecks.
 *   3. Includes both personal + business-linked entries.
 *   4. Optionally includes projected paychecks (forecast scope).
 */

import type { TaxDebugBreakdown } from "@/lib/taxCalculationService";

export interface CanonicalWithholdingBucket {
  /** Federal income tax + SS + Medicare withheld (canonical). */
  federal: number;
  /** State income tax withheld. */
  state: number;
  /** federal + state. */
  total: number;
}

export interface CanonicalWithholdingComponents {
  /** Personal income entries (W-2 + non-W2 personal) federal withholding. */
  personalFederal: number;
  personalState: number;
  /** Business income entries (1099, K-1, S-Corp) federal withholding. */
  businessFederal: number;
  businessState: number;
  /** Projected/future paycheck federal withholding (forecast scope only). */
  projectedFederal: number;
  projectedState: number;
}

export interface CanonicalWithholding {
  /** Year-to-date actual withholding only. Use for "Paid so far" displays. */
  actual: CanonicalWithholdingBucket;
  /** Actual + projected (current-year forecast). Use for projection math. */
  forecast: CanonicalWithholdingBucket;
  components: CanonicalWithholdingComponents;
}

export function selectCanonicalWithholding(
  actualDebug: TaxDebugBreakdown | null | undefined,
  forecastDebug: TaxDebugBreakdown | null | undefined,
): CanonicalWithholding {
  const aF = Number(actualDebug?.actualFederalWithheld ?? actualDebug?.federalWithheld ?? 0);
  const aS = Number(actualDebug?.actualStateWithheld ?? actualDebug?.stateWithheld ?? 0);
  const pF = Number(forecastDebug?.projectedFederalWithheld ?? 0);
  const pS = Number(forecastDebug?.projectedStateWithheld ?? 0);

  // Forecast totals: prefer engine's combined total, otherwise actual + projected.
  const fF = Number(forecastDebug?.federalWithheld ?? aF + pF);
  const fS = Number(forecastDebug?.stateWithheld ?? aS + pS);

  return {
    actual: { federal: aF, state: aS, total: aF + aS },
    forecast: { federal: fF, state: fS, total: fF + fS },
    components: {
      // The engine doesn't separate personal vs business in the debug surface,
      // so we expose the combined actual under personalFederal=actual and
      // 0 for business; consumers needing splits should extend the debug
      // type. Kept for forward compatibility / debug logging.
      personalFederal: aF,
      personalState: aS,
      businessFederal: 0,
      businessState: 0,
      projectedFederal: pF,
      projectedState: pS,
    },
  };
}

/**
 * Dev-only debug logger. Print every component + final totals so future
 * audits can spot drift between pages immediately. Enable via:
 *   localStorage.setItem("debug:withholding", "1")
 * or in any environment where import.meta.env.DEV is true.
 */
export function logCanonicalWithholding(
  source: string,
  w: CanonicalWithholding,
): void {
  if (typeof window === "undefined") return;
  const flagged =
    (import.meta as { env?: { DEV?: boolean } }).env?.DEV ||
    (typeof localStorage !== "undefined" &&
      localStorage.getItem("debug:withholding") === "1");
  if (!flagged) return;
  // eslint-disable-next-line no-console
  console.groupCollapsed(`[withholding:${source}]`);
  // eslint-disable-next-line no-console
  console.table({
    "actual.federal": w.actual.federal,
    "actual.state": w.actual.state,
    "actual.total": w.actual.total,
    "forecast.federal": w.forecast.federal,
    "forecast.state": w.forecast.state,
    "forecast.total": w.forecast.total,
    "components.projectedFederal": w.components.projectedFederal,
    "components.projectedState": w.components.projectedState,
  });
  // eslint-disable-next-line no-console
  console.groupEnd();
}
