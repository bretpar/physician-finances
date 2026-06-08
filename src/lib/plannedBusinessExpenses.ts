// ============================================================================
// plannedBusinessExpenses — pure helpers for projecting planned/forecast
// business expenses entered on K-1 / 1099 / Schedule-C income streams.
//
// Used by:
//   1. `useTaxBreakdown` (forecast mode) to subtract planned expenses from
//      the "K-1 / business profit" income source card.
//   2. Tests, to lock in the include-planned profit math so a planned K-1
//      stream with `forecast_expense_per_period = 2000` × 6 active monthly
//      periods reduces planned K-1 profit by $12,000 (not $0).
//
// NOTE: The unified tax engine consumes planned expenses through
// `getProjectedTotals(...).forecastBusinessExpenses` (which is summed per
// active SE paycheck in `useProjectedIncome.ts`). This helper mirrors that
// per-stream math for the breakdown UI keyed by company so the displayed
// "Total business profit" matches the engine's forecast taxable income.
// ============================================================================

import { normalizeFilingType, type FilingType } from "@/lib/filingTypes";

const BUSINESS_FILING_TYPES: ReadonlySet<FilingType> = new Set([
  "1099_schedule_c",
  "k1_partnership",
  "scorp_distribution",
]);

export interface PlannedExpenseStreamLite {
  id: string;
  company: string;
  company_type: string;
  source_id?: string | null;
  is_active: boolean;
  forecast_expense_per_period: number;
}

export interface PlannedExpensePaycheckLite {
  streamId: string;
  type: "paycheck" | "bonus";
  matchStatus: string;
}

export interface CompanyLite {
  id: string;
  name: string;
}

const normName = (s: string) => (s || "").trim().toLowerCase();

/**
 * Resolve the canonical companyId for a planned stream. Prefers the
 * stream's `source_id`; otherwise falls back to a case-insensitive name
 * match against the companies catalog so streams without `source_id` still
 * project onto the right business entity.
 */
export function resolvePlannedStreamCompanyId(
  stream: PlannedExpenseStreamLite,
  companies: CompanyLite[],
): string | null {
  if (stream.source_id) return stream.source_id;
  if (!stream.company) return null;
  const n = normName(stream.company);
  return companies.find((c) => normName(c.name) === n)?.id ?? null;
}

export interface PlannedExpenseBucket {
  companyId: string | null;
  companyName: string;
  filingType: FilingType;
  total: number;
}

/**
 * Compute planned (forecast) business expenses keyed by companyId (or by
 * normalized company name when no companyId can be resolved). The result
 * is intended to be merged into the per-company expense aggregate used by
 * the Tax Breakdown UI in `mode === "forecast"`.
 */
export function aggregatePlannedBusinessExpenses(
  streams: PlannedExpenseStreamLite[],
  paychecks: PlannedExpensePaycheckLite[],
  companies: CompanyLite[],
): Map<string, PlannedExpenseBucket> {
  // Count active planned paycheck occurrences per stream.
  const activeByStream = new Map<string, number>();
  for (const p of paychecks) {
    if (p.matchStatus !== "active") continue;
    if (p.type !== "paycheck") continue;
    activeByStream.set(p.streamId, (activeByStream.get(p.streamId) || 0) + 1);
  }

  const out = new Map<string, PlannedExpenseBucket>();
  for (const stream of streams) {
    if (!stream.is_active) continue;
    const perPeriod = Math.max(0, Number(stream.forecast_expense_per_period) || 0);
    if (perPeriod <= 0) continue;
    const ft = normalizeFilingType(stream.company_type);
    if (!BUSINESS_FILING_TYPES.has(ft)) continue;
    const activeCount = activeByStream.get(stream.id) || 0;
    if (activeCount <= 0) continue;

    const companyId = resolvePlannedStreamCompanyId(stream, companies);
    const companyName =
      (companyId ? companies.find((c) => c.id === companyId)?.name : null) ||
      stream.company ||
      "Planned";
    const key = companyId || `name::${normName(companyName)}::${ft}`;
    const plannedExpense = perPeriod * activeCount;

    const existing = out.get(key);
    if (existing) {
      existing.total += plannedExpense;
    } else {
      out.set(key, {
        companyId,
        companyName,
        filingType: ft,
        total: plannedExpense,
      });
    }
  }
  return out;
}
