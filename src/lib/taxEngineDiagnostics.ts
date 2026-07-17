// ============================================================================
// Tax Engine Diagnostics (developer-only)
// ============================================================================
// Zero-cost when off. Enable in the browser console with:
//     localStorage.setItem("debug:taxEngine", "1")
//
// What this catches
// -----------------
// 1. Single-instance invariant. Every screen in the app should be consuming
//    the SAME TaxDebugBreakdown object identity for a given scope
//    ("actual" | "currentPace" | "forecast") within a render pass. If two
//    consumers report different identities, useTaxEstimate is being wired
//    around instead of through, or a component is memoising a stale copy.
//
// 2. Drift assertions. A UI that displays a canonical number (AGI, federal
//    tax, effective rate, etc.) can call `assertNoDrift(...)` with the
//    number it is about to render. If it deviates from the engine value by
//    more than the tolerance, we log a labelled warning identifying the
//    page, field, displayed value, and canonical value.
//
// The intent is to make future tax audits mechanical: turn the flag on,
// exercise every tax view, and any drift shows up immediately in the
// console without changing user-visible behaviour.
// ============================================================================

import type { TaxDebugBreakdown } from "@/lib/taxCalculationService";

export type TaxScope = "actual" | "currentPace" | "forecast";

const CONSOLE_PREFIX = "[taxEngine]";

function diagnosticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("debug:taxEngine") === "1";
  } catch {
    return false;
  }
}

interface ScopeState {
  lastIdentity: TaxDebugBreakdown | null;
  consumers: Map<string, TaxDebugBreakdown>;
}

const scopes: Record<TaxScope, ScopeState> = {
  actual: { lastIdentity: null, consumers: new Map() },
  currentPace: { lastIdentity: null, consumers: new Map() },
  forecast: { lastIdentity: null, consumers: new Map() },
};

export function registerTaxEstimateConsumer(
  consumerName: string,
  scope: TaxScope,
  debug: TaxDebugBreakdown | null,
): void {
  if (!diagnosticsEnabled() || !debug) return;
  const s = scopes[scope];
  s.consumers.set(consumerName, debug);
  if (s.lastIdentity && s.lastIdentity !== debug) {
    // eslint-disable-next-line no-console
    console.warn(
      `${CONSOLE_PREFIX} multiple debug identities for scope="${scope}"`,
      { consumer: consumerName, consumers: Array.from(s.consumers.keys()) },
    );
  }
  s.lastIdentity = debug;
}

export interface DriftAssertionOptions {
  /** Absolute tolerance in dollars (default $1). */
  dollarTolerance?: number;
  /** Absolute tolerance in percentage points for rate fields (default 0.01 pp). */
  rateTolerance?: number;
  /** True if the field is a rate (already expressed as a percentage). */
  isRate?: boolean;
}

export function assertNoDrift(
  pageName: string,
  field: keyof TaxDebugBreakdown | string,
  displayedValue: number,
  canonicalValue: number,
  opts: DriftAssertionOptions = {},
): void {
  if (!diagnosticsEnabled()) return;
  if (!Number.isFinite(displayedValue) || !Number.isFinite(canonicalValue)) return;
  const tol = opts.isRate
    ? (opts.rateTolerance ?? 0.01)
    : (opts.dollarTolerance ?? 1);
  if (Math.abs(displayedValue - canonicalValue) <= tol) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${CONSOLE_PREFIX} drift page=${pageName} field=${String(field)} displayed=${displayedValue} canonical=${canonicalValue} delta=${(displayedValue - canonicalValue).toFixed(4)}`,
  );
}

/** Test-only helpers. */
export const __diagnosticsInternal = {
  reset(): void {
    (Object.keys(scopes) as TaxScope[]).forEach((k) => {
      scopes[k].lastIdentity = null;
      scopes[k].consumers.clear();
    });
  },
  snapshot(scope: TaxScope) {
    return {
      lastIdentity: scopes[scope].lastIdentity,
      consumers: Array.from(scopes[scope].consumers.entries()),
    };
  },
  enabled: diagnosticsEnabled,
};
