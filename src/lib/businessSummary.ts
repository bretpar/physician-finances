/**
 * Canonical Business Summary
 *
 * Single source of truth for "Business Revenue / Business Deductions /
 * Business Profit" totals shown across the app.
 *
 * Consumers:
 *  - Dashboard (Business Profit card in IncomeBreakdownCards, DashboardMetrics
 *    YTD + forecast Business Profit)
 *  - Business Activity page (hero card + Revenue/Deductions row)
 *  - Any other summary card that displays "Business Profit"
 *
 * Rules (must match everywhere so the two pages cannot drift):
 *  1. A transaction counts toward business only when its assigned company has
 *     `companyType` in {`1099_schedule_c`, `k1_partnership`}, OR it is a
 *     YTD-catchup mirror row (`origin_type='ytd_catchup'`) whose `company_type`
 *     is in that set.
 *  2. Rows are excluded per `isExcludedFromBusiness` (personal, transfers,
 *     `excluded_from_reports`) and per the unassigned/auto-assigned-interest
 *     rule (Plaid interest with no company or an untouched auto-assignment).
 *  3. Deductions = business expense transactions + Schedule-C mileage
 *     deduction (only mileage entries on Schedule-C companies).
 *  4. Profit = Revenue − Deductions.
 *
 * Planned mode (`includePlanned=true`) additionally sums active projected
 * paychecks on business streams and adds their per-period forecast expenses
 * from the stream.
 */

import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { getIrsMileageRate } from "@/hooks/useMileage";

export const BUSINESS_COMPANY_TYPES: ReadonlySet<string> = new Set([
  "1099_schedule_c",
  "k1_partnership",
]);
export const SCHEDULE_C_COMPANY_TYPE = "1099_schedule_c";

export interface BusinessSummary {
  revenue: number;
  txExpenses: number;
  mileageDeduction: number;
  deductions: number; // txExpenses + mileageDeduction
  profit: number;     // revenue − deductions
}

export interface BusinessSummaryCompany {
  id: string;
  companyType: string;
}

export interface BusinessSummaryInputs {
  /** Transactions already filtered by any user-facing filters (search, date range, etc.). */
  transactions: readonly any[];
  mileageEntries?: readonly any[];
  companies: readonly BusinessSummaryCompany[];
  projectedPaychecks?: readonly any[];
  streams?: readonly any[];
  /** Company filter: undefined or "all" = every business company. */
  companyFilter?: string;
  /** When true, adds active planner paychecks + per-period forecast expenses. */
  includePlanned?: boolean;
}

function isInterestIncome(tx: any): boolean {
  if (tx?.transaction_type !== "income") return false;
  const text = `${tx?.vendor || ""} ${tx?.category || ""}`.toLowerCase();
  return /\binterest\b/.test(text);
}

function isUnassignedOrAutoAssignedInterest(tx: any): boolean {
  if (!isInterestIncome(tx)) return false;
  if (!tx.source_id) return true;
  return (tx.source_type || "manual") === "plaid" && !tx.user_edited;
}

function companyPasses(sourceId: string | null | undefined, filter?: string): boolean {
  if (!filter || filter === "all") return true;
  return (sourceId || "") === filter;
}

export function computeBusinessSummary({
  transactions,
  mileageEntries = [],
  companies,
  projectedPaychecks = [],
  streams = [],
  companyFilter,
  includePlanned = false,
}: BusinessSummaryInputs): BusinessSummary {
  const businessCompanyIds = new Set<string>();
  const scheduleCCompanyIds = new Set<string>();
  for (const c of companies) {
    if (BUSINESS_COMPANY_TYPES.has(c.companyType)) businessCompanyIds.add(c.id);
    if (c.companyType === SCHEDULE_C_COMPANY_TYPE) scheduleCCompanyIds.add(c.id);
  }

  const businessStreamIds = new Set<string>();
  const forecastExpenseByStreamId = new Map<string, number>();
  for (const s of streams) {
    const t = String((s as any).company_type || "").toLowerCase();
    if (BUSINESS_COMPANY_TYPES.has(t) || t === "1099") businessStreamIds.add((s as any).id);
    forecastExpenseByStreamId.set(
      (s as any).id,
      Number((s as any).forecast_expense_per_period || 0),
    );
  }

  const isBusinessRow = (t: any): boolean => {
    if (!t) return false;
    if (isExcludedFromBusiness(t)) return false;
    if (isUnassignedOrAutoAssignedInterest(t)) return false;
    const sourceId = t.source_id as string | null | undefined;
    const bySource = !!sourceId && businessCompanyIds.has(sourceId);
    const byCatchup =
      t.origin_type === "ytd_catchup" &&
      BUSINESS_COMPANY_TYPES.has(String(t.company_type || ""));
    if (!bySource && !byCatchup) return false;
    if (!companyPasses(sourceId, companyFilter)) return false;
    return true;
  };

  let revenue = 0;
  let txExpenses = 0;
  for (const t of transactions) {
    if (!isBusinessRow(t)) continue;
    const amt = Math.abs(Number(t.amount) || 0);
    if (t.transaction_type === "income") revenue += amt;
    else if (t.transaction_type === "expense") txExpenses += amt;
  }

  let mileageDeduction = 0;
  for (const m of mileageEntries) {
    const cid = (m as any).company_id as string | null | undefined;
    if (!cid || !scheduleCCompanyIds.has(cid)) continue;
    if (!companyPasses(cid, companyFilter)) continue;
    mileageDeduction += Number((m as any).miles || 0) * getIrsMileageRate((m as any).year);
  }

  if (includePlanned) {
    for (const p of projectedPaychecks) {
      if ((p as any).matchStatus !== "active") continue;
      const sid = (p as any).streamSourceId as string | null | undefined;
      const streamId = (p as any).streamId as string | undefined;
      const isBiz =
        (!!sid && businessCompanyIds.has(sid)) ||
        (!!streamId && businessStreamIds.has(streamId));
      if (!isBiz) continue;
      if (companyFilter && companyFilter !== "all" && (sid || "") !== companyFilter) continue;
      revenue += Number((p as any).grossAmount || 0);
      if (streamId) txExpenses += Number(forecastExpenseByStreamId.get(streamId) || 0);
    }
  }

  const deductions = txExpenses + mileageDeduction;
  return {
    revenue,
    txExpenses,
    mileageDeduction,
    deductions,
    profit: revenue - deductions,
  };
}
