/**
 * Pure helper for the canonical "Recommended quarterly payment" calculation.
 *
 * Used by:
 *   - components/dashboard/QuarterlyTracker.tsx
 *   - components/dashboard/QuarterlyPaymentCallout.tsx
 *
 * Definitions:
 *   paidThisQuarter   = W-2 federal withholding + 1099/K-1 federal withholding
 *                       on income dated this quarter + estimated tax payments
 *                       logged with applied_quarter/applied_tax_year for this quarter.
 *   savedThisQuarter  = paycheck `additional_tax_reserve` + transaction
 *                       `actual_withholding` + investment `actual_tax_saved`,
 *                       MINUS any portion already converted into estimated
 *                       payments (to avoid double counting once a user logs
 *                       a payment from their reserve).
 *   recommendedQuarterlyPayment = max(0, quarterTarget - paid - saved)
 */
import { getQuarterPayments, type QuarterLabel } from "@/lib/quarters";
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import type { InvestmentIncomeEntry } from "@/hooks/useInvestmentIncome";

export type QuarterNum = 1 | 2 | 3 | 4;

export interface QuarterRecommendationInput {
  annualTaxLiability: number;
  year: number;
  quarter: QuarterNum;
  quarterMethod?: "even" | "dynamic";
  incomeEntries?: any[];
  personalEntries?: any[];
  transactions?: any[];
  investmentEntries?: InvestmentIncomeEntry[];
  projectedPaychecks?: Array<{ date: string; grossAmount: number }>;
  payments?: Array<{
    quarter?: string;
    applied_quarter?: string;
    applied_tax_year?: number;
    payment_date?: string;
    amount: number | string;
  }>;
}

export interface QuarterRecommendation {
  label: QuarterLabel;
  year: number;
  quarter: QuarterNum;
  start: Date;
  end: Date; // exclusive
  deadline: Date;
  deadlineLabel: string;
  quarterTarget: number;
  /** W-2 federal withholding on personal_income rows dated this quarter. */
  w2WithheldThisQuarter: number;
  /** 1099/K-1 federal withholding on business income rows dated this quarter. */
  otherWithheldThisQuarter: number;
  /** Estimated tax payments logged for this applied_quarter/tax_year. */
  estimatedPaymentsThisQuarter: number;
  /** w2Withheld + otherWithheld + estimatedPayments. */
  paidThisQuarter: number;
  /** Raw reserves (before subtracting estimated payments). */
  rawSavedThisQuarter: number;
  /** Reserves still earmarked (raw saved – estimated payments, floored at 0). */
  savedThisQuarter: number;
  /** max(0, quarterTarget - paidThisQuarter - savedThisQuarter). */
  recommendedQuarterlyPayment: number;
  /** Percent of target covered (paid+saved). 0-100+. */
  coveragePct: number;
}

const Q_META: Record<QuarterNum, { label: QuarterLabel; deadlineLabel: string }> = {
  1: { label: "Q1", deadlineLabel: "Apr 15" },
  2: { label: "Q2", deadlineLabel: "Jun 15" },
  3: { label: "Q3", deadlineLabel: "Sep 15" },
  4: { label: "Q4", deadlineLabel: "Jan 15" },
};

function buildWindow(year: number, quarter: QuarterNum) {
  const meta = Q_META[quarter];
  let start: Date, end: Date, deadline: Date;
  if (quarter === 1) { start = new Date(year, 0, 1); end = new Date(year, 3, 1); deadline = new Date(year, 3, 15); }
  else if (quarter === 2) { start = new Date(year, 3, 1); end = new Date(year, 6, 1); deadline = new Date(year, 5, 15); }
  else if (quarter === 3) { start = new Date(year, 6, 1); end = new Date(year, 9, 1); deadline = new Date(year, 8, 15); }
  else { start = new Date(year, 9, 1); end = new Date(year + 1, 0, 1); deadline = new Date(year + 1, 0, 15); }
  return { start, end, deadline, label: meta.label, deadlineLabel: meta.deadlineLabel };
}

export function computeQuarterRecommendation(
  input: QuarterRecommendationInput,
): QuarterRecommendation {
  const {
    annualTaxLiability,
    year,
    quarter,
    quarterMethod = "even",
    incomeEntries = [],
    personalEntries = [],
    transactions = [],
    investmentEntries = [],
    projectedPaychecks = [],
    payments = [],
  } = input;

  const { start, end, deadline, label, deadlineLabel } = buildWindow(year, quarter);
  const inWin = (iso: string) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d >= start && d < end;
  };

  // ── Quarter target ──────────────────────────────────────────────────────
  let quarterTarget: number;
  if (quarterMethod !== "dynamic") {
    quarterTarget = Math.max(0, annualTaxLiability / 4);
  } else {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const inYear = (iso: string) => {
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
    // Net-profit-aware share: subtract business expenses from both numerator
    // and denominator so quarters with heavy expenses don't get over-targeted.
    const qNet = Math.max(0, qIncome - qBusinessExpenses);
    const yearNet = Math.max(0, yearIncome - yearBusinessExpenses);
    quarterTarget = yearNet > 0 ? Math.max(0, annualTaxLiability * (qNet / yearNet)) : 0;
  }

  // ── Paid (real withholding + estimated payments) ─────────────────────────
  const liveTxById = new Map(
    transactions
      .filter((t) => t?.transaction_type === "income" && !isExcludedFromBusiness(t))
      .map((t) => [t.id, t] as const),
  );

  let otherWithheldThisQuarter = 0;
  let businessSaved = 0;
  for (const e of incomeEntries) {
    if (!e.linked_transaction_id) continue;
    const tx = liveTxById.get(e.linked_transaction_id);
    if (!tx) continue;
    if (!inWin(e.income_date)) continue;
    otherWithheldThisQuarter += getTotalFederalPaid(e);
    businessSaved +=
      Number((tx as any).actual_withholding || 0) +
      Number(e.additional_tax_reserve || 0);
  }

  let w2WithheldThisQuarter = 0;
  let w2Saved = 0;
  for (const e of personalEntries) {
    if (!inWin(e.income_date)) continue;
    w2WithheldThisQuarter += getTotalFederalPaid(e);
    w2Saved += Number(e.additional_tax_reserve || 0);
  }

  let investmentSaved = 0;
  for (const e of investmentEntries) {
    if (!inWin(e.entry_date)) continue;
    investmentSaved += Math.max(0, Number(e.actual_tax_saved ?? 0));
  }

  const estimatedPaymentsThisQuarter = getQuarterPayments(payments, label, year);
  const paidThisQuarter =
    w2WithheldThisQuarter + otherWithheldThisQuarter + estimatedPaymentsThisQuarter;

  const rawSavedThisQuarter = businessSaved + w2Saved + investmentSaved;
  // Once a reserve has been converted into an estimated payment, don't count
  // those dollars as still-saved.
  const savedThisQuarter = Math.max(0, rawSavedThisQuarter - estimatedPaymentsThisQuarter);

  const recommendedQuarterlyPayment = Math.max(
    0,
    quarterTarget - paidThisQuarter - savedThisQuarter,
  );
  const coveragePct = quarterTarget > 0
    ? ((paidThisQuarter + savedThisQuarter) / quarterTarget) * 100
    : 100;

  return {
    label,
    year,
    quarter,
    start,
    end,
    deadline,
    deadlineLabel,
    quarterTarget,
    w2WithheldThisQuarter,
    otherWithheldThisQuarter,
    estimatedPaymentsThisQuarter,
    paidThisQuarter,
    rawSavedThisQuarter,
    savedThisQuarter,
    recommendedQuarterlyPayment,
    coveragePct,
  };
}

/** Difference in whole calendar days (deadline - today), positive when due in the future. */
export function daysUntilDeadline(deadline: Date, now: Date = new Date()): number {
  const a = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/**
 * Dashboard rule: show the compact payment callout only between 20 days
 * before the deadline and 7 days after, and only when the recommended
 * payment is meaningful (> $100) and coverage is below 95%.
 */
export function shouldShowDashboardPaymentCallout(
  rec: Pick<QuarterRecommendation, "deadline" | "recommendedQuarterlyPayment" | "coveragePct">,
  now: Date = new Date(),
): { show: boolean; overdue: boolean; daysUntilDue: number } {
  const daysUntilDue = daysUntilDeadline(rec.deadline, now);
  const inWindow = daysUntilDue <= 20 && daysUntilDue >= -7;
  const meaningful = rec.recommendedQuarterlyPayment > 100;
  const notCovered = rec.coveragePct < 95;
  return {
    show: inWindow && meaningful && notCovered,
    overdue: daysUntilDue < 0,
    daysUntilDue,
  };
}
