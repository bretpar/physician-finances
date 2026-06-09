/**
 * Quarter / estimated-tax deadline helpers shared across the app.
 *
 * IRS estimated-tax deadlines:
 *   Q1 → Apr 15
 *   Q2 → Jun 15
 *   Q3 → Sep 15
 *   Q4 → Jan 15 (of following year)
 */

export type QuarterNumber = 1 | 2 | 3 | 4;
export type QuarterLabel = "Q1" | "Q2" | "Q3" | "Q4";

export interface QuarterInfo {
  quarter: QuarterNumber;
  label: QuarterLabel;
  deadline: Date;
  /** e.g. "Q2 (Jun 15)" */
  longLabel: string;
  /** e.g. "Jun 15" */
  deadlineLabel: string;
}

/**
 * True 3-month calendar quarter for `now`:
 *   Q1: Jan–Mar (due Apr 15)
 *   Q2: Apr–Jun (due Jun 15)
 *   Q3: Jul–Sep (due Sep 15)
 *   Q4: Oct–Dec (due Jan 15 next year)
 *
 * The Dashboard progress tracker and YTD-catchup mirror both rely on this
 * mapping so a June paycheck is treated as Q2 income (Apr–Jun) rather than
 * being lumped into the IRS Q3 estimated-tax window.
 */
export function getCurrentQuarter(now: Date = new Date()): QuarterInfo {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month < 3) return mk(1, new Date(year, 3, 15), "Apr 15");
  if (month < 6) return mk(2, new Date(year, 5, 15), "Jun 15");
  if (month < 9) return mk(3, new Date(year, 8, 15), "Sep 15");
  return mk(4, new Date(year + 1, 0, 15), "Jan 15");
}

/** Backwards-compatible alias used by useIncomeRecommendation. */
export function getNextQuarterDeadline(): { quarter: number; deadline: Date; quarterLabel: string } {
  const q = getCurrentQuarter();
  return { quarter: q.quarter, deadline: q.deadline, quarterLabel: q.longLabel };
}

function mk(q: QuarterNumber, deadline: Date, deadlineLabel: string): QuarterInfo {
  const label = `Q${q}` as QuarterLabel;
  return { quarter: q, label, deadline, longLabel: `${label} (${deadlineLabel})`, deadlineLabel };
}

/**
 * Sum the amounts of tax_payments rows whose applied tax quarter (and optionally
 * applied tax year) match. Falls back to legacy `quarter` field when
 * `applied_quarter` isn't present on the row.
 */
export function getQuarterPayments<
  T extends {
    quarter?: string;
    applied_quarter?: string;
    applied_tax_year?: number;
    payment_date?: string;
    amount: number | string;
  },
>(payments: T[] | undefined, quarter: QuarterLabel, taxYear?: number): number {
  if (!payments) return 0;
  return payments
    .filter((p) => {
      const q = (p.applied_quarter || p.quarter || "").toUpperCase();
      if (q !== quarter) return false;
      if (taxYear == null) return true;
      const y =
        p.applied_tax_year ??
        (p.payment_date ? new Date(p.payment_date + "T00:00:00").getFullYear() : undefined);
      return y === taxYear;
    })
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}
