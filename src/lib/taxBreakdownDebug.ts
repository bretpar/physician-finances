/**
 * Developer/debug toggle for Tax Breakdown rendering.
 *
 * When enabled (via the toggle on the Taxes page or by setting
 * `localStorage["debug:taxBreakdown"] = "1"`), `useTaxBreakdown` logs the
 * resolved companyId, dedupe key, and merged-source counts for every
 * business/K-1 entity it produces. Useful for diagnosing duplicate-card
 * regressions.
 */

const STORAGE_KEY = "debug:taxBreakdown";
const EVENT = "debug:taxBreakdown:changed";

export function isTaxBreakdownDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTaxBreakdownDebugEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: enabled }));
  } catch {
    /* no-op */
  }
}

export function subscribeTaxBreakdownDebug(cb: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(isTaxBreakdownDebugEnabled());
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export interface BusinessDebugRow {
  companyName: string;
  filingType: string;
  resolvedCompanyId: string | null;
  dedupeKey: string;
  mergedFrom: number;
  revenue: number;
  expenses: number;
  profit: number;
}

export function logTaxBreakdown(args: {
  mode: string;
  rows: BusinessDebugRow[];
  totalSourcesBeforeMerge: number;
  totalSourcesAfterMerge: number;
}): void {
  if (!isTaxBreakdownDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.groupCollapsed(
    `[useTaxBreakdown] mode=${args.mode} • sources ${args.totalSourcesBeforeMerge}→${args.totalSourcesAfterMerge} • ${args.rows.length} business/K-1`,
  );
  // eslint-disable-next-line no-console
  console.table(args.rows);
  // eslint-disable-next-line no-console
  console.groupEnd();
}
