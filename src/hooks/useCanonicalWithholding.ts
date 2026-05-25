import { useMemo } from "react";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  selectCanonicalWithholding,
  logCanonicalWithholding,
  type CanonicalWithholding,
} from "@/lib/canonicalWithholding";

/**
 * Single-source hook returning canonical withholding totals consumed by
 * Paychecks (Personal Income), Withholding Guide (Projected Income), and
 * Tax Overview (Taxes). See `src/lib/canonicalWithholding.ts`.
 */
export function useCanonicalWithholding(source: string): CanonicalWithholding {
  const { actualDebug, forecastDebug } = useTaxEstimate();
  const w = useMemo(
    () => selectCanonicalWithholding(actualDebug, forecastDebug),
    [actualDebug, forecastDebug],
  );
  logCanonicalWithholding(source, w);
  return w;
}
