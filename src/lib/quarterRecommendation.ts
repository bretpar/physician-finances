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
 *   paidThisQuarter   = W-2/payroll federal withholding (getTotalFederalPaid)
 *                     + 1099/K-1 federal withholding on income dated this quarter
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
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
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
 * Calendar quarter window plus IRS estimated-tax deadline.
 * Mirrors `getCurrentQuarter` from `src/lib/quarters.ts` for any (year, quarter).
 */
function buildWindow(year: number, quarter: QuarterNum) {
  const meta = Q_META[quarter];
  let start: Date, end: Date, deadline: Date;
  if (quarter === 1) { start = new Date(year, 0, 1); end = new Date(year, 3, 1); deadline = new Date(year, 3, 15); }
  else if (quarter === 2) { start = new Date(year, 3, 1); end = new Date(year, 6, 1); deadline = new Date(year, 5, 15); }
  else if (quarter === 3) { start = new Date(year, 6, 1); end = new Date(year, 9, 1); deadline = new Date(year, 8, 15); }
  else { start = new Date(year, 9, 1); end = new Date(year + 1, 0, 1); deadline = new Date(year + 1, 0, 15); }
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
  } = input;

  const { start, end, deadline, label, deadlineLabel } = buildWindow(year, quarter);
  const inWin = (iso?: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d >= start && d < end;
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
      const d = new Date(iso);
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

  let otherWithheldThisQuarter = 0;
  let businessSavedFromIncome = 0;
  for (const e of incomeEntries) {
    if (!e.linked_transaction_id) continue;
    const tx = liveTxById.get(e.linked_transaction_id);
    if (!tx) continue;
    if (!inWin(e.income_date)) continue;
    const paid = getTotalFederalPaid(e);
    const saved =
      Number((tx as any).actual_withholding || 0) +
      Number(e.additional_tax_reserve || 0);
    otherWithheldThisQuarter += paid;
    businessSavedFromIncome += saved;
    if (paid > 0 || saved > 0) {
      const name = (e.company || "Business income").toString().trim() || "Business income";
      const key = e.source_id ? `source:${e.source_id}` : `name:${name.toLowerCase()}`;
      const row = ensure(key, name);
      row.paid += paid;
      row.saved += saved;
    }
  }

  let w2WithheldThisQuarter = 0;
  let w2SavedFromIncome = 0;
  for (const e of personalEntries) {
    if (!inWin(e.income_date)) continue;
    const paid = getTotalFederalPaid(e);
    const saved = Number(e.additional_tax_reserve || 0);
    w2WithheldThisQuarter += paid;
    w2SavedFromIncome += saved;
    if (paid > 0 || saved > 0) {
      const name = (e.company || "Personal W-2").toString().trim() || "Personal W-2";
      const row = ensure(`personal:${name.toLowerCase()}`, `${name} (W-2)`);
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
  const daysUntilDue = daysUntilDeadline(deadline, now);
  const meaningful = recommendedQuarterlyPayment > 100;
  const notCovered = coverageRatio < 0.95;
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
    sourceRows: Array.from(buckets.values()),
    w2WithheldThisQuarter,
    otherWithheldThisQuarter,
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
