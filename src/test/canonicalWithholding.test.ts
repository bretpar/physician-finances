/**
 * Cross-page canonical withholding snapshot test.
 *
 * Guards against the audit-reported $20,120 vs $14,000 drift between
 * Paychecks (Personal Income), Withholding Guide (Projected Income), and
 * Tax Overview (Taxes). All three pages must consume the same
 * `selectCanonicalWithholding()` output.
 */

import { describe, it, expect } from "vitest";
import { selectCanonicalWithholding } from "@/lib/canonicalWithholding";
import type { TaxDebugBreakdown } from "@/lib/taxCalculationService";

const debug = (overrides: Partial<TaxDebugBreakdown> = {}): TaxDebugBreakdown =>
  ({
    actualFederalWithheld: 0,
    actualStateWithheld: 0,
    projectedFederalWithheld: 0,
    projectedStateWithheld: 0,
    federalWithheld: 0,
    stateWithheld: 0,
    ...overrides,
  } as TaxDebugBreakdown);

describe("canonical withholding selector", () => {
  it("returns identical actual totals regardless of caller (Paychecks vs Tax Overview vs Guide)", () => {
    const a = debug({ actualFederalWithheld: 14000, actualStateWithheld: 2200 });
    const f = debug({
      actualFederalWithheld: 14000,
      actualStateWithheld: 2200,
      projectedFederalWithheld: 6120,
      projectedStateWithheld: 800,
      federalWithheld: 20120,
      stateWithheld: 3000,
    });

    const paychecks = selectCanonicalWithholding(a, f);
    const guide = selectCanonicalWithholding(a, f);
    const overview = selectCanonicalWithholding(a, f);

    expect(paychecks.actual.federal).toBe(14000);
    expect(guide.actual.federal).toBe(14000);
    expect(overview.actual.federal).toBe(14000);

    expect(paychecks.actual).toEqual(guide.actual);
    expect(guide.actual).toEqual(overview.actual);
    expect(paychecks.forecast).toEqual(overview.forecast);
  });

  it("never produces the audit-reported $20,120 vs $14,000 drift", () => {
    const a = debug({ actualFederalWithheld: 14000 });
    const f = debug({
      actualFederalWithheld: 14000,
      projectedFederalWithheld: 6120,
      federalWithheld: 20120,
    });
    const w = selectCanonicalWithholding(a, f);
    // Paychecks + Guide YTD chip + Tax Overview "withholding paid" all show 14000
    expect(w.actual.federal).toBe(14000);
    // Forecast (projection math) shows 20120 — but consistently across pages
    expect(w.forecast.federal).toBe(20120);
    // The two values differ legitimately (actual vs forecast scope), but for a
    // fixed scope every page must report the same number.
  });

  it("uses combined fallback when actual fields are missing (legacy debug)", () => {
    const a = debug({ federalWithheld: 9000, stateWithheld: 500 });
    const w = selectCanonicalWithholding(a, a);
    expect(w.actual.federal).toBe(9000);
    expect(w.actual.state).toBe(500);
    expect(w.actual.total).toBe(9500);
  });

  it("handles null/undefined debug gracefully", () => {
    const w = selectCanonicalWithholding(null, null);
    expect(w.actual.total).toBe(0);
    expect(w.forecast.total).toBe(0);
  });

  it("forecast.federal = actual + projected when engine total missing", () => {
    const a = debug({ actualFederalWithheld: 5000 });
    const f = debug({ actualFederalWithheld: 5000, projectedFederalWithheld: 3000 });
    const w = selectCanonicalWithholding(a, f);
    expect(w.forecast.federal).toBe(8000);
  });
});
