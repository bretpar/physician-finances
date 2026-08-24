/**
 * Canonical helper for the "Recommended quarterly estimated tax payment".
 *
 * Single source of truth used by:
 *   - components/dashboard/QuarterlyTracker.tsx       (Tax Overview header + tracker)
 *   - components/dashboard/QuarterlyPaymentCallout.tsx (Dashboard near-deadline callout)
 *   - pages/Dashboard.tsx                              (Financial Score quarter math)
 *   - pages/Taxes.tsx                                  (Tax Overview)
 *
 * Quarter labels, calendar windows, and IRS due dates are sourced from
 * `src/lib/quarters.ts` so every caller agrees on the same Q1–Q4 boundaries.
 *
 * Formula:
 *   recommendedQuarterlyPayment =
 *     max(0, quarterTarget - paidThisQuarter - savedThisQuarter)
 *
 *   paidThisQuarter   = W-2 federal income-tax withholding (`federal_withholding` only)
 *                     + 1099/K-1 federal payroll withholding on income dated this quarter
 *                     + estimated tax payments logged for this applied_quarter
 *                       (getQuarterPayments).
 *   savedThisQuarter  = reserves (paycheck additional_tax_reserve,
 *                     + transaction.actual_withholding, investment actual_tax_saved,
 *                     + manual tax_savings entries) minus any portion already
 *                     converted into estimated tax payments (double-count guard):
 *
 *     savedThisQuarter = max(0, rawSavedThisQuarter - estimatedPaymentsMade)
 *
 * Reserves are NEVER reported as paid.
 */
import {
  getQuarterPayments,
  getCurrentQuarter,
  type QuarterLabel,
  type QuarterNumber,
} from "@/lib/quarters";
import { getFederalIncomeTaxWithheld } from "@/lib/federalWithholding";
import {
  computeCatchUpRecommendation,
  deriveBaselineQuarterTarget,

  type CoverageStatus,
} from "@/lib/catchUpRecommendation";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { isBusinessIncomeType } from "@/lib/ledgerRouting";
import { parseLocalDate } from "@/lib/localDate";

import type { InvestmentIncomeEntry } from "@/hooks/useInvestmentIncome";

export type QuarterNum = QuarterNumber;

export type DashboardCalloutMode = "none" | "due_soon" | "overdue";

export interface QuarterRecommendationInput {
  annualTaxLiability: number;
  /** Defaults to the current calendar year. */
  year?: number;
  /** Defaults to the current calendar quarter. */
  quarter?: QuarterNum;
  quarterMethod?: "even" | "dynamic";
  incomeEntries?: any[];
  personalEntries?: any[];
  transactions?: any[];
  investmentEntries?: InvestmentIncomeEntry[];
  /** Used only in dynamic mode to share annual liability across quarters. */
  projectedPaychecks?: Array<{ date: string; grossAmount: number }>;
  payments?: Array<{
    quarter?: string;
    applied_quarter?: string;
    applied_tax_year?: number;
    payment_date?: string;
    amount: number | string;
  }>;
  /** Optional manual `tax_savings` rows (counted toward "savedFromIncome"). */
  manualSavings?: Array<{ savings_date?: string; amount: number | string }>;
  /**
   * Whether state income tax is part of `annualTaxLiability`. When true, state
   * withholding dated in the quarter counts toward Paid — keeping the target
   * and the credits symmetric. When false (default) state tax is neither in
   * the target nor credited.
   */
  stateIncomeTaxIncludedInTarget?: boolean;
  /**
   * Remaining savings opportunities (paychecks / income events) before the
   * deadline, used to spread any shortfall PROSPECTIVELY. Defaults to 1.
   */
  remainingOpportunities?: number;
  /**
   * Quarter target the user was previously recommended against, when known.
   * Only used to label a gap as "estimate increased" instead of "behind".
   */
  baselineQuarterTarget?: number;
  /**
   * Income entry ids whose recommendation was created by the liability-changing
   * event currently being evaluated. Excluded from the prior-compliance
   * baseline only — no dollar amount, aggregation or source row is affected.
   */
  excludeRecommendationEntryIds?: string[];

  /** Used for the "due soon / overdue" callout window. Defaults to `new Date()`. */
  now?: Date;
}


export interface QuarterSourceRow {
  key: string;
  label: string;
  /** Real submitted withholding/payments dated this quarter. */
  paid: number;
  /** Reserves earmarked but not yet paid. */
  saved: number;
}

export interface QuarterRecommendation {
  // ── Identifiers ───────────────────────────────────────────────────────────
  /** Canonical quarter label (e.g. "Q2"). Same value as `quarter`. */
  quarterLabel: QuarterLabel;
  /** Backwards-compat alias of quarterLabel. */
  label: QuarterLabel;
  /** Numeric quarter (1-4). */
  quarter: QuarterNum;
  /** Tax year the quarter belongs to. */
  taxYear: number;
  /** Backwards-compat alias of taxYear. */
  year: number;

  // ── Window ────────────────────────────────────────────────────────────────
  /** Start of the calendar quarter (inclusive). */
  start: Date;
  /** End of the calendar quarter (exclusive). */
  end: Date;
  /** IRS estimated-tax due date for the quarter. */
  deadline: Date;
  /** Short display label, e.g. "Jun 15". */
  deadlineLabel: string;

  // ── Money ─────────────────────────────────────────────────────────────────
  quarterTarget: number;
  paidFromWithholding: number;        // W-2 + 1099/K-1 federal withholding
  estimatedPaymentsMade: number;      // logged tax_payments for this quarter
  paidThisQuarter: number;            // paidFromWithholding + estimatedPaymentsMade
  savedFromIncome: number;            // additional_tax_reserve (W-2 + biz) + actual_withholding + manual tax_savings
  savedFromInvestments: number;       // investment actual_tax_saved
  manualTaxSavings: number;           // manual tax_savings rows only
  rawSavedThisQuarter: number;        // sum of all reserves before double-count guard
  savedThisQuarter: number;           // rawSaved - estimatedPaymentsMade, floored at 0
  progressAmount: number;             // paid + saved
  recommendedQuarterlyPayment: number;
  /**
   * Amount the user should actually submit as an estimated tax payment for the
   * quarter. Subtracts only ACTUAL paid/withheld dollars — saved/reserved cash
   * that has not been submitted is NOT subtracted here (it shows separately as
   * savings progress toward making this payment).
   *
   *   recommendedPaymentToMake = max(0, quarterTarget - paidThisQuarter)
   */
  recommendedPaymentToMake: number;
  /** max(0, recommendedPaymentToMake - savedThisQuarter). */
  stillNeedToSave: number;
  coverageRatio: number;              // (paid + saved) / target, 0-1+
  /** @deprecated use coverageRatio. */
  coveragePct: number;

  // ── Deadline display flags ────────────────────────────────────────────────
  daysUntilDue: number;
  isDueSoonWindow: boolean;
  isOverdueWindow: boolean;
  showDashboardPaymentCallout: boolean;
  dashboardCalloutMode: DashboardCalloutMode;

  // ── Per-company breakdown ─────────────────────────────────────────────────
  sourceRows: QuarterSourceRow[];

  // ── Informational payroll taxes (never credited) ──────────────────────────
  /**
   * Employee Social Security + Medicare withheld from W-2 paychecks dated in
   * this quarter. Shown as "already handled" — NEVER counted toward Paid,
   * because the quarter target contains income tax + SE tax (+ state), not
   * employee FICA.
   */
  payrollTaxesHandledThisQuarter: number;
  /** State withholding dated this quarter (credited only when in target). */
  stateWithheldThisQuarter: number;
  /** Whether state withholding was credited toward Paid. */
  stateIncomeTaxIncludedInTarget: boolean;

  // ── Prospective catch-up + status ─────────────────────────────────────────
  /** Signed gap for the quarter: positive = shortfall, negative = surplus. */
  shortfallOrSurplus: number;
  /** Dollars still needed by the deadline (floored at 0). */
  totalShortfallByDeadline: number;
  /** Opportunities the shortfall is spread across (>= 1). */
  remainingOpportunities: number;
  /** Per-opportunity catch-up to add to future recommendations. */
  catchUpPerOpportunity: number;
  coverageStatus: CoverageStatus;
  statusHeadline: string;
  statusDetail: string;
  /**
   * Quarter target the user was effectively recommended against (0 when unknown).
   * Exposed so surfaces that recompute catch-up with their own
   * `remainingOpportunities` keep the same "estimate increased" vs "behind"
   * classification instead of falling back to generic catch-up copy.
   */
  baselineQuarterTarget: number;

  // ── Legacy duplicate fields kept for older callers ────────────────────────
  /** @deprecated split into paidFromWithholding. */
  w2WithheldThisQuarter: number;
  /** @deprecated split into paidFromWithholding. */
  otherWithheldThisQuarter: number;
  /** @deprecated use estimatedPaymentsMade. */
  estimatedPaymentsThisQuarter: number;
}


const Q_META: Record<QuarterNum, { label: QuarterLabel; deadlineLabel: string }> = {
  1: { label: "Q1", deadlineLabel: "Apr 15" },
  2: { label: "Q2", deadlineLabel: "Jun 15" },
  3: { label: "Q3", deadlineLabel: "Sep 15" },
  4: { label: "Q4", deadlineLabel: "Jan 15" },
};

/**
 * IRS estimated-tax period window for (year, quarter):
 *   Q1: Jan 1 – Mar 31, deadline Apr 15
 *   Q2: Apr 1 – May 31, deadline Jun 15
 *   Q3: Jun 1 – Aug 31, deadline Sep 15
 *   Q4: Sep 1 – Dec 31, deadline Jan 15 of next year
 * Mirrors `getCurrentQuarter` from `src/lib/quarters.ts`.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

function buildWindow(year: number, quarter: QuarterNum) {
  const meta = Q_META[quarter];
  let start: Date, end: Date, deadline: Date;
  if (quarter === 1) { start = new Date(year, 0, 1); end = new Date(year, 3, 1); deadline = new Date(year, 3, 15); }
  else if (quarter === 2) { start = new Date(year, 3, 1); end = new Date(year, 5, 1); deadline = new Date(year, 5, 15); }
  else if (quarter === 3) { start = new Date(year, 5, 1); end = new Date(year, 8, 1); deadline = new Date(year, 8, 15); }
  else { start = new Date(year, 8, 1); end = new Date(year + 1, 0, 1); deadline = new Date(year + 1, 0, 15); }
  return { start, end, deadline, label: meta.label, deadlineLabel: meta.deadlineLabel };
}

export function buildQuarterRecommendation(
  input: QuarterRecommendationInput,
): QuarterRecommendation {
  const now = input.now ?? new Date();
  const current = getCurrentQuarter(now);
  const year = input.year ?? now.getFullYear();
  const quarter = input.quarter ?? current.quarter;

  const {
    annualTaxLiability,
    quarterMethod = "even",
    incomeEntries = [],
    personalEntries = [],
    transactions = [],
    investmentEntries = [],
    projectedPaychecks = [],
    payments = [],
    manualSavings = [],
    stateIncomeTaxIncludedInTarget = false,
  } = input;

  const { start, end, deadline, label, deadlineLabel } = buildWindow(year, quarter);
  // "Today" cutoff (end of today, local) — used so future-dated paychecks /
  // income entries never count as actually paid/withheld.
  const todayCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const inWin = (iso?: string | null) => {
    if (!iso) return false;
    const d = parseLocalDate(iso);
    if (!d) return false;
    return d >= start && d < end;
  };
  const isPast = (iso?: string | null) => {
    if (!iso) return false;
    const d = parseLocalDate(iso);
    if (!d) return false;
    return d < todayCutoff;
  };

  // ── Quarter target ───────────────────────────────────────────────────────
  let quarterTarget: number;
  if (quarterMethod !== "dynamic") {
    quarterTarget = Math.max(0, annualTaxLiability / 4);
  } else {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const inYear = (iso?: string | null) => {
      if (!iso) return false;
      const d = parseLocalDate(iso);
    if (!d) return false;
      return d >= yearStart && d < yearEnd;
    };
    let qIncome = 0;
    let yearIncome = 0;
    let qBusinessExpenses = 0;
    let yearBusinessExpenses = 0;
    for (const t of transactions) {
      if (t?.transaction_type === "income") {
        const amt = Math.abs(Number(t.amount) || 0);
        if (inYear(t.transaction_date)) yearIncome += amt;
        if (inWin(t.transaction_date)) qIncome += amt;
      } else if (t?.transaction_type === "expense" && !isExcludedFromBusiness(t)) {
        const amt = Math.abs(Number(t.amount) || 0);
        if (inYear(t.transaction_date)) yearBusinessExpenses += amt;
        if (inWin(t.transaction_date)) qBusinessExpenses += amt;
      }
    }
    for (const e of personalEntries) {
      const amt = Number(e.gross_amount || e.paycheck_amount || 0);
      if (inYear(e.income_date)) yearIncome += amt;
      if (inWin(e.income_date)) qIncome += amt;
    }
    for (const p of projectedPaychecks) {
      const amt = Number(p.grossAmount || 0);
      if (inYear(p.date)) yearIncome += amt;
      if (inWin(p.date)) qIncome += amt;
    }
    for (const e of investmentEntries) {
      const amt = Number(e.taxable_amount || 0);
      if (inYear(e.entry_date)) yearIncome += amt;
      if (inWin(e.entry_date)) qIncome += amt;
    }
    // Net-profit-aware share: subtract business expenses from both sides so
    // expense-heavy quarters aren't over-targeted.
    const qNet = Math.max(0, qIncome - qBusinessExpenses);
    const yearNet = Math.max(0, yearIncome - yearBusinessExpenses);
    quarterTarget = yearNet > 0 ? Math.max(0, annualTaxLiability * (qNet / yearNet)) : 0;
  }

  // ── Per-source paid + saved + bucket totals ──────────────────────────────
  const liveTxById = new Map(
    transactions
      .filter((t) => t?.transaction_type === "income" && !isExcludedFromBusiness(t))
      .map((t) => [t.id, t] as const),
  );

  const buckets = new Map<string, QuarterSourceRow>();
  const ensure = (key: string, label: string): QuarterSourceRow => {
    let row = buckets.get(key);
    if (!row) {
      row = { key, label, paid: 0, saved: 0 };
      buckets.set(key, row);
    }
    return row;
  };

  /**
   * Canonical bucket key for an income row. Grouping by the stable
   * `source_id` (the employer/business record) — never by display label —
   * guarantees the SAME employer can't surface as two rows
   * ("Employer" + "Employer (W-2)") just because two code paths formatted
   * the label differently.
   *
   * `scope` namespaces W-2 employers apart from 1099/K-1 businesses. Production
   * defect: a manual 1099 entry whose `source_id` collided with (or was written
   * as) the W-2 employer's source id landed in the W-2 row, so its $2,305
   * reserve showed as W-2 Saved and no 1099 row appeared. A W-2 employer and a
   * business source are distinct canonical entities and must never collapse.
   */
  const bucketKeyFor = (e: any, fallbackName: string, scope: "w2" | "biz") =>
    e?.source_id
      ? `${scope}:source:${e.source_id}`
      : `${scope}:name:${fallbackName.toLowerCase()}`;

  // ── Row-level double-count guard ─────────────────────────────────────────
  // `useIncomeEntries()` selects EVERY `income_entries` row (no
  // `source_bucket` filter), while `usePersonalIncomeEntries()` selects the
  // personal (W-2) subset of the SAME table. Callers pass both lists, so
  // without this guard each W-2 paycheck was aggregated twice: once by the
  // business loop (inflating Paid, Saved and "Other federal withholding
  // paid") and once by the personal loop — the production $1,873 → $3,746
  // defect, with the employer appearing as two rows.
  //
  // Identity is the row id (never the display label). Rows already owned by
  // the personal/W-2 loop are skipped in the business loop entirely.
  const personalEntryIds = new Set(
    personalEntries.map((e: any) => e?.id).filter(Boolean),
  );
  const hasPersonalList = personalEntries.length > 0;
  /**
   * A 1099 / K-1 / S-corp-distribution row is BUSINESS income even when the
   * writer stored it with `source_bucket = 'personal'` (which happens for some
   * filing types). `usePersonalIncomeEntries()` filters those rows OUT of the
   * personal list, so the old `source_bucket === 'personal'` fallback below
   * dropped them from BOTH loops — their reserve (and the linked deposit's
   * `actual_withholding`) never reached `savedThisQuarter` and no 1099 source
   * row appeared. Income type wins over the stored bucket here.
   */
  const isBusinessTypeRow = (e: any) =>
    isBusinessIncomeType(e?.income_type) || isBusinessIncomeType(e?.company_type);
  const isPersonalOwnedRow = (e: any) => {
    if (isBusinessTypeRow(e)) return false;
    if (e?.id && personalEntryIds.has(e.id)) return true;
    // Defensive: a personal-bucket row that (for any reason) isn't in the
    // personal list is still not business income. Only apply when a personal
    // list was supplied, so callers that pass personal rows exclusively via
    // `incomeEntries` keep working.
    return hasPersonalList && e?.source_bucket === "personal";
  };

  /** Row ids already accounted for, so nothing can be counted twice. */
  const accountedRowIds = new Set<string>();

  let otherWithheldThisQuarter = 0;
  // Informational only — employee SS/Medicare are never income-tax credits.
  let payrollTaxesHandledThisQuarter = 0;
  let stateWithheldThisQuarter = 0;
  let businessSavedFromIncome = 0;
  for (const e of incomeEntries) {
    if (isPersonalOwnedRow(e)) continue;
    if (e?.id && accountedRowIds.has(e.id)) continue;
    // Business/1099 Paid path: an income entry may legitimately have NO linked
    // bank transaction (manual 1099/K-1 entry). Those rows previously fell out
    // of Paid/Saved entirely. Only skip when the entry POINTS AT a transaction
    // that is missing or intentionally excluded from business — that exclusion
    // is deliberate.
    const tx = e.linked_transaction_id
      ? liveTxById.get(e.linked_transaction_id)
      : undefined;
    if (e.linked_transaction_id && !tx) continue;
    if (!inWin(e.income_date)) continue;
    // Paid (actual withholding already submitted) requires the income to
    // have already occurred — future-dated entries don't yet have paid tax.
    // Federal income tax withheld ONLY — SS/Medicare are payroll taxes and are
    // never income-tax credits, so they can never count toward quarterly Paid.
    // State withholding is credited ONLY when state tax is part of the target.
    const businessState = stateIncomeTaxIncludedInTarget
      ? Math.max(0, Number((e as any).state_withholding || 0))
      : 0;
    const paid = isPast(e.income_date)
      ? getFederalIncomeTaxWithheld(e) + businessState
      : 0;
    if (isPast(e.income_date)) stateWithheldThisQuarter += businessState;
    const saved =
      Number((tx as any)?.actual_withholding || 0) +
      Number(e.additional_tax_reserve || 0);
    if (e?.id) accountedRowIds.add(e.id);
    otherWithheldThisQuarter += paid;
    businessSavedFromIncome += saved;
    if (paid > 0 || saved > 0) {
      const name = (e.company || "Business income").toString().trim() || "Business income";
      const row = ensure(bucketKeyFor(e, name, "biz"), name);
      row.paid += paid;
      row.saved += saved;
    }
  }

  // W-2 federal withholding counted as "Paid" for the displayed quarter must
  // reflect only dollars ACTUALLY withheld from paychecks dated within the
  // quarter window AND on or before today. Future-dated planned paychecks
  // and out-of-window paychecks never count as already-paid here. They may
  // still influence the quarter target via dynamic-share, but never inflate
  // Paid QTD.
  let w2WithheldThisQuarter = 0;
  let w2SavedFromIncome = 0;
  for (const e of personalEntries) {
    // Same row can never be aggregated twice (e.g. duplicated across the
    // business + personal lists, or a repeated list entry).
    if ((e as any)?.id && accountedRowIds.has((e as any).id)) continue;
    if ((e as any)?.id) accountedRowIds.add((e as any).id);
    const inQuarter = inWin(e.income_date);
    // YTD-catchup mirror entries represent withholding accrued from Jan 1
    // through their `period_end` (stored as income_date). Allocate linearly
    // across [jan1, period_end] and credit only the slice that overlaps
    // [quarter_start, min(today, quarter_end)] to this quarter, so future
    // portions of the period never show as paid yet.
    const isYtdCatchup =
      (e as any).origin_type === "ytd_catchup" ||
      (e as any).entry_kind === "ytd_catchup";
    let paid = 0;
    if (isYtdCatchup) {
      const periodEnd = parseLocalDate(e.income_date);
      if (periodEnd && periodEnd.getFullYear() === year) {
        const jan1 = new Date(year, 0, 1);
        const totalMs = Math.max(1, periodEnd.getTime() - jan1.getTime());
        const sliceEnd = Math.min(
          periodEnd.getTime(),
          end.getTime(),
          todayCutoff.getTime(),
        );
        const sliceStart = Math.max(jan1.getTime(), start.getTime());
        const overlapMs = Math.max(0, sliceEnd - sliceStart);
        const ratio = Math.min(1, overlapMs / totalMs);
        paid = Math.max(0, Number(e.federal_withholding || 0)) * ratio;
      }
    } else {
      // Actual W-2 paycheck: count only if it falls in this quarter AND has
      // already occurred (income_date <= today). Federal income tax
      // withholding ONLY — payroll SS/Medicare are not income-tax credits.
      const countAsPaid = inQuarter && isPast(e.income_date);
      paid = countAsPaid ? Math.max(0, Number(e.federal_withholding || 0)) : 0;
      if (countAsPaid) {
        // Symmetry rule: credit state withholding only when state income tax
        // is part of the quarter target.
        const st = Math.max(0, Number((e as any).state_withholding || 0));
        stateWithheldThisQuarter += st;
        if (stateIncomeTaxIncludedInTarget) paid += st;
        payrollTaxesHandledThisQuarter +=
          Math.max(0, Number((e as any).ss_withholding || 0)) +
          Math.max(0, Number((e as any).medicare_withholding || 0));
      }
    }
    const saved = inQuarter ? Number(e.additional_tax_reserve || 0) : 0;
    w2WithheldThisQuarter += paid;
    w2SavedFromIncome += saved;
    if (paid > 0 || saved > 0) {
      const name = (e.company || "Personal W-2").toString().trim() || "Personal W-2";
      // Group by the stable source/employer id when present so a W-2 employer
      // that also has business rows shares ONE canonical bucket instead of
      // splitting into "Employer" + "Employer (W-2)".
      const row = ensure(bucketKeyFor(e, name, "w2"), `${name} (W-2)`);
      row.paid += paid;
      row.saved += saved;
    }
  }


  let savedFromInvestments = 0;
  for (const e of investmentEntries) {
    if (!inWin(e.entry_date)) continue;
    savedFromInvestments += Math.max(0, Number(e.actual_tax_saved ?? 0));
  }
  if (savedFromInvestments > 0) {
    ensure("__investments__", "Investment income").saved += savedFromInvestments;
  }

  let manualTaxSavings = 0;
  for (const s of manualSavings) {
    if (!inWin(s.savings_date)) continue;
    manualTaxSavings += Math.max(0, Number(s.amount) || 0);
  }
  if (manualTaxSavings > 0) {
    ensure("__manual_tax_savings__", "Manual tax savings").saved += manualTaxSavings;
  }

  const estimatedPaymentsMade = getQuarterPayments(payments, label, year);
  if (estimatedPaymentsMade > 0) {
    ensure("__estimated_payments__", `${label} estimated payments`).paid += estimatedPaymentsMade;
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const paidFromWithholding = w2WithheldThisQuarter + otherWithheldThisQuarter;
  const paidThisQuarter = paidFromWithholding + estimatedPaymentsMade;
  const savedFromIncome = w2SavedFromIncome + businessSavedFromIncome + manualTaxSavings;
  const rawSavedThisQuarter = savedFromIncome + savedFromInvestments;
  // Double-count guard: once a reserve is logged as an estimated payment,
  // don't count those dollars as still-saved.
  const savedThisQuarter = Math.max(0, rawSavedThisQuarter - estimatedPaymentsMade);
  const progressAmount = paidThisQuarter + savedThisQuarter;

  // ── Source-row reconciliation ────────────────────────────────────────────
  // The double-count guard above reduces the headline Saved when reserves are
  // converted into an estimated payment. The estimated payment shows up as its
  // own `paid` row, so `sum(rows.paid) === paidThisQuarter` already holds — but
  // the per-source `saved` values still carry the pre-guard balances, which made
  // the expanded "This Quarter by Source" table over-report Saved by exactly the
  // payment amount.
  //
  // An estimated payment cannot be deterministically attributed to the specific
  // reserve(s) that funded it, so we apply the SAME guard pro-rata across every
  // row that holds saved dollars. That keeps the presentation honest (each source
  // keeps its proportional share) and guarantees the invariants:
  //   sum(rows.paid)  === paidThisQuarter
  //   sum(rows.saved) === savedThisQuarter
  //   sum(rows.paid + rows.saved) === progressAmount
  const rows = Array.from(buckets.values());
  if (rawSavedThisQuarter > 0 && savedThisQuarter < rawSavedThisQuarter) {
    const savedRows = rows.filter((r) => r.saved > 0);
    if (savedThisQuarter <= 0) {
      // Payment absorbed every reserved dollar.
      for (const r of savedRows) r.saved = 0;
    } else {
      const scale = savedThisQuarter / rawSavedThisQuarter;
      let allocated = 0;
      savedRows.forEach((r, i) => {
        if (i === savedRows.length - 1) {
          // Last row absorbs any floating-point residual so the sum is exact.
          r.saved = Math.max(0, savedThisQuarter - allocated);
        } else {
          r.saved = r.saved * scale;
          allocated += r.saved;
        }
      });
    }
  }

  // ── Prospective catch-up + status language ───────────────────────────────
  // Shortfalls are spread across REMAINING opportunities only; past
  // recommendations are never rewritten.
  //
  // When the caller doesn't supply a baseline, derive it from the per-row
  // recommendation snapshots so a target that moved up AFTER the user followed
  // every prior recommendation reads "estimate increased" instead of "behind".
  const complianceRows: Array<{ id?: string | null; recommended: number; satisfied: number }> = [];
  const seenComplianceIds = new Set<string>();
  for (const e of [...incomeEntries, ...personalEntries] as any[]) {
    if (e?.id) {
      if (seenComplianceIds.has(e.id)) continue;
      seenComplianceIds.add(e.id);
    }
    if (!inWin(e?.income_date)) continue;
    const recommended = Math.max(0, Number(e?.dynamic_tax_recommendation || 0));
    if (recommended <= 0) continue;
    const tx = e?.linked_transaction_id ? liveTxById.get(e.linked_transaction_id) : undefined;
    const satisfied =
      Math.max(0, Number(e?.additional_tax_reserve || 0)) +
      Math.max(0, Number((tx as any)?.actual_withholding || 0)) +
      Math.max(0, getFederalIncomeTaxWithheld(e));
    complianceRows.push({ id: e?.id ?? null, recommended, satisfied });
  }
  const baselineQuarterTarget =
    input.baselineQuarterTarget ??
    deriveBaselineQuarterTarget(
      complianceRows,
      progressAmount,
      input.excludeRecommendationEntryIds,
    );


  const catchUp = computeCatchUpRecommendation({
    quarterTarget,
    coveredSoFar: progressAmount,
    remainingOpportunities: input.remainingOpportunities,
    baselineQuarterTarget,
  });


  const recommendedQuarterlyPayment = Math.max(
    0,
    quarterTarget - paidThisQuarter - savedThisQuarter,
  );
  // New: amount user should actually submit. Excludes saved/reserved cash —
  // reserves remain in the user's account until they convert them into an
  // estimated payment.
  const recommendedPaymentToMake = Math.max(0, quarterTarget - paidThisQuarter);
  const stillNeedToSave = Math.max(0, recommendedPaymentToMake - savedThisQuarter);
  const coverageRatio = quarterTarget > 0 ? progressAmount / quarterTarget : 1;
  const coveragePct = coverageRatio * 100;

  // ── Deadline / callout windows ───────────────────────────────────────────
  // Dashboard priority rule: an active unpaid payment deadline should override
  // the normal in-progress quarter tracker during the due window. "Covered"
  // here means actually paid (W-2 withholding + estimated payments) — saved
  // reserves are user cash that has NOT yet been submitted, so they must not
  // suppress the payment callout. Otherwise a user with reserves but no
  // actual payment would see the Q3 tracker on Jun 9 instead of the Q2
  // Payment Due card.
  const daysUntilDue = daysUntilDeadline(deadline, now);
  const paidCoverageRatio = quarterTarget > 0 ? paidThisQuarter / quarterTarget : 1;
  const meaningful = recommendedPaymentToMake > 100;
  const notCovered = paidCoverageRatio < 0.95;
  const isDueSoonWindow = daysUntilDue <= 20 && daysUntilDue >= 0 && meaningful && notCovered;
  const isOverdueWindow = daysUntilDue < 0 && daysUntilDue >= -7 && meaningful && notCovered;
  const showDashboardPaymentCallout = isDueSoonWindow || isOverdueWindow;
  const dashboardCalloutMode: DashboardCalloutMode = isOverdueWindow
    ? "overdue"
    : isDueSoonWindow
      ? "due_soon"
      : "none";

  return {
    quarterLabel: label,
    label,
    quarter,
    taxYear: year,
    year,
    start,
    end,
    deadline,
    deadlineLabel,
    quarterTarget,
    paidFromWithholding,
    estimatedPaymentsMade,
    paidThisQuarter,
    savedFromIncome,
    savedFromInvestments,
    manualTaxSavings,
    rawSavedThisQuarter,
    savedThisQuarter,
    progressAmount,
    recommendedQuarterlyPayment,
    recommendedPaymentToMake,
    stillNeedToSave,
    coverageRatio,
    coveragePct,
    daysUntilDue,
    isDueSoonWindow,
    isOverdueWindow,
    showDashboardPaymentCallout,
    dashboardCalloutMode,
    sourceRows: rows,
    w2WithheldThisQuarter,
    otherWithheldThisQuarter,
    payrollTaxesHandledThisQuarter: round2(payrollTaxesHandledThisQuarter),
    stateWithheldThisQuarter: round2(stateWithheldThisQuarter),
    stateIncomeTaxIncludedInTarget,
    shortfallOrSurplus: catchUp.shortfallOrSurplus,
    totalShortfallByDeadline: catchUp.totalShortfallByDeadline,
    remainingOpportunities: catchUp.remainingOpportunities,
    catchUpPerOpportunity: catchUp.quarterlyAdjustmentAmount,
    coverageStatus: catchUp.recommendationStatus,
    statusHeadline: catchUp.statusHeadline,
    statusDetail: catchUp.statusDetail,
    baselineQuarterTarget: round2(baselineQuarterTarget),
    estimatedPaymentsThisQuarter: estimatedPaymentsMade,
  };
}

/** Back-compat alias — older callers used `computeQuarterRecommendation`. */
export const computeQuarterRecommendation = buildQuarterRecommendation;

/** Whole calendar-day delta (deadline - today), positive when in the future. */
export function daysUntilDeadline(deadline: Date, now: Date = new Date()): number {
  const a = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/**
 * Dashboard rule: show the compact payment callout only between 20 days
 * before the deadline and 7 days after, and only when the recommended
 * payment is meaningful (> $100) and coverage is below 95%.
 *
 * Prefer reading `recommendation.showDashboardPaymentCallout` /
 * `dashboardCalloutMode` directly; this helper is kept for callers that
 * previously consumed the explicit `{ show, overdue }` shape.
 */
export function shouldShowDashboardPaymentCallout(
  rec: Pick<
    QuarterRecommendation,
    "deadline" | "recommendedQuarterlyPayment" | "coverageRatio" | "coveragePct"
  >,
  now: Date = new Date(),
): { show: boolean; overdue: boolean; daysUntilDue: number } {
  const daysUntilDue = daysUntilDeadline(rec.deadline, now);
  const inWindow = daysUntilDue <= 20 && daysUntilDue >= -7;
  const meaningful = rec.recommendedQuarterlyPayment > 100;
  const ratio = rec.coverageRatio ?? (rec.coveragePct ?? 0) / 100;
  const notCovered = ratio < 0.95;
  return {
    show: inWindow && meaningful && notCovered,
    overdue: daysUntilDue < 0,
    daysUntilDue,
  };
}

/**
 * Choose which quarter the Dashboard payment callout should target.
 *
 * The IRS estimated-tax deadline for Q2 is Jun 15, which falls inside the
 * calendar Q3 window (Jun 1 – Aug 31). So on e.g. Jun 9 the calendar quarter
 * is already Q3, but the next relevant payment deadline is Q2's Jun 15.
 *
 * Rule: if the previous quarter's IRS deadline is within the dashboard
 * payment window (≤20 days in the future or ≤7 days past), the active
 * payment target is the previous quarter. Otherwise it is the current
 * calendar quarter.
 */
export function getActivePaymentTarget(now: Date = new Date()): {
  year: number;
  quarter: QuarterNum;
} {
  // Pick the nearest IRS estimated-tax deadline that is still upcoming, or up
  // to 7 days past (grace window so a just-missed deadline still surfaces on
  // the Dashboard). Scan adjacent years so prior-year Q4 (Jan 15) and
  // next-year transitions resolve correctly.
  const baseYear = now.getFullYear();
  let best: { year: number; quarter: QuarterNum } | null = null;
  let bestDays = Infinity;
  for (const yr of [baseYear - 1, baseYear, baseYear + 1]) {
    for (const q of [1, 2, 3, 4] as QuarterNum[]) {
      const w = buildWindow(yr, q);
      const d = daysUntilDeadline(w.deadline, now);
      if (d < -7) continue;
      if (d < bestDays) {
        bestDays = d;
        best = { year: yr, quarter: q };
      }
    }
  }
  if (best) return best;
  const current = getCurrentQuarter(now);
  return { year: baseYear, quarter: current.quarter };
}
