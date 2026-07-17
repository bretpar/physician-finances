// ============================================================================
// Page-level canonical-engine consistency verifier
// ============================================================================
// This complements the scenario runner: at runtime, checks that every major
// page has consumed the SAME TaxDebugBreakdown identity for a given scope,
// using the registry maintained by taxEngineDiagnostics. If a page is
// missing or shows a different identity, the report calls it out.
//
// The list of expected consumers is co-located here (data-driven). Pages
// register themselves through the existing `registerTaxEstimateConsumer`
// path inside useTaxEstimate.
// ============================================================================

import type { TaxDebugBreakdown } from "@/lib/taxCalculationService";
import { __diagnosticsInternal, type TaxScope } from "@/lib/taxEngineDiagnostics";

/** Pages that MUST consume the canonical TaxEstimate. */
export const REQUIRED_CANONICAL_CONSUMERS = [
  "Dashboard",
  "Taxes",              // Tax Overview
  "BusinessActivity",
  "PersonalIncome",
  "W4Calculator",       // W-4 Calculator dialog/section
  "AnnualTaxSummary",   // Annual Tax Summary panel
  "TaxPrepPdf",         // Tax Prep PDF export
  "QuarterlyTax",       // Quarterly Tax planner
] as const;

export type CanonicalConsumer = (typeof REQUIRED_CANONICAL_CONSUMERS)[number];

export interface ConsumerReportRow {
  page: CanonicalConsumer | string;
  registered: boolean;
  sharesCanonicalIdentity: boolean;
  identityLabel: string;
}

export interface PageConsistencyReport {
  scope: TaxScope;
  canonicalIdentityLabel: string;
  rows: ConsumerReportRow[];
  missing: string[];
  drifted: string[];
  ok: boolean;
}

function identityLabel(b: TaxDebugBreakdown | null | undefined): string {
  if (!b) return "—";
  // Use a stable-ish label: engine identity + a few discriminating numbers.
  return `#${(b as unknown as { __id?: string }).__id ?? Math.abs(hash(JSON.stringify([b.agi, b.totalEstimatedTax, b.federalIncomeTax]))).toString(36)}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

export function verifyPageConsistency(scope: TaxScope = "actual"): PageConsistencyReport {
  const snap = __diagnosticsInternal.snapshot(scope);
  const canonical = snap.lastIdentity;
  const canonicalLabel = identityLabel(canonical);
  const consumers = new Map(snap.consumers);

  const rows: ConsumerReportRow[] = REQUIRED_CANONICAL_CONSUMERS.map((page) => {
    const debug = consumers.get(page) ?? null;
    return {
      page,
      registered: debug != null,
      sharesCanonicalIdentity: !!debug && debug === canonical,
      identityLabel: identityLabel(debug),
    };
  });

  const missing = rows.filter((r) => !r.registered).map((r) => r.page as string);
  const drifted = rows
    .filter((r) => r.registered && !r.sharesCanonicalIdentity)
    .map((r) => r.page as string);

  return {
    scope,
    canonicalIdentityLabel: canonicalLabel,
    rows,
    missing,
    drifted,
    ok: missing.length === 0 && drifted.length === 0,
  };
}
