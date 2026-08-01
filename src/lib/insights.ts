/**
 * Insights selection — DISPLAY LOGIC ONLY.
 *
 * Every number that appears in an insight is passed in from calculations that
 * already exist (canonical tax engine, quarter recommendation, tax-savings
 * hooks). This module performs no tax math, no API calls and no writes.
 *
 * Contract:
 *  - Insights are built from a fixed priority ladder and truncated to 5.
 *  - An insight is only produced while its condition still holds, so it
 *    auto-disappears once the user resolves it (no manual dismissal).
 */

export type InsightSeverity = "critical" | "action" | "info" | "success";

export type InsightId =
  | "quarterly-overdue"
  | "quarterly-due-soon"
  | "tax-savings-behind"
  | "tax-savings-slightly-behind"
  | "add-income"
  | "retirement"
  | "hsa"
  | "home-office"
  | "mileage"
  | "student-loan-interest"
  | "income-increased"
  | "income-decreased"
  | "quarterly-on-track";

export interface Insight {
  id: InsightId;
  severity: InsightSeverity;
  /** Lower number = higher priority. */
  priority: number;
  icon: "alert" | "calendar" | "piggy" | "trending-up" | "trending-down" | "check";
  title: string;
  description: string;
  cta: string;
  to: string;
}

export interface InsightsInput {
  /** False while any dependency query is still loading. */
  isReady: boolean;
  projectedAnnualIncome: number;
  annualTaxLiability: number;
  /**
   * Pace ratio (0-1+) from `computeQuarterPace` — saved-to-date over the
   * amount recommended AS OF TODAY. Never the full-quarter coverage ratio.
   */
  savingsCoverageRatio: number;
  /** max(0, recommendedToDate - savedToDate) from `computeQuarterPace`. */
  stillNeedToSave: number;
  quarterLabel: string;
  deadlineLabel: string;
  daysUntilDue: number;
  showQuarterly: boolean;
  hasRetirement: boolean;
  hasHsa: boolean;
  hasHomeOffice: boolean;
  hasMileage: boolean;
  hasStudentLoanInterest: boolean;
  /** Signed change vs. the last observed projected income baseline (0 when none). */
  incomeChange: number;
}

/** At/above this share of TODAY's recommended set-aside the user is on track. */
export const COVERAGE_TARGET = 0.95;
/** Between this and COVERAGE_TARGET the user is only "slightly behind". */
export const SLIGHTLY_BEHIND_TARGET = 0.8;
/** Within this many days a deadline is surfaced. */
export const DEADLINE_WINDOW_DAYS = 30;
/** Minimum absolute projected-income swing worth surfacing. */
export const INCOME_CHANGE_THRESHOLD = 5000;
export const MAX_INSIGHTS = 5;

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(Math.round(n)));

export function buildInsights(input: InsightsInput): Insight[] {
  if (!input.isReady) return [];

  const income = num(input.projectedAnnualIncome);
  const tax = num(input.annualTaxLiability);
  const coverage = Math.max(0, num(input.savingsCoverageRatio));
  const stillNeedToSave = Math.max(0, num(input.stillNeedToSave));
  const daysUntilDue = num(input.daysUntilDue);
  const incomeChange = num(input.incomeChange);
  const quarterLabel = input.quarterLabel || "this quarter";
  const quarterlyRelevant = input.showQuarterly && tax > 0;
  const onTrack = coverage >= COVERAGE_TARGET;
  const behind = quarterlyRelevant && coverage < SLIGHTLY_BEHIND_TARGET;
  const slightlyBehind = quarterlyRelevant && !onTrack && !behind;

  const out: Insight[] = [];

  // 1. Deadlines.
  if (quarterlyRelevant && !onTrack && daysUntilDue < 0) {
    out.push({
      id: "quarterly-overdue",
      severity: "critical",
      priority: 1,
      icon: "alert",
      title: `${quarterLabel} Payment Overdue`,
      description: `Your ${quarterLabel} estimated payment deadline has passed. Review your tax savings plan.`,
      cta: "Log a Payment",
      to: "/taxes?logPayment=" + encodeURIComponent(quarterLabel) + "#quarterly-estimator",
    });
  } else if (quarterlyRelevant && daysUntilDue >= 0 && daysUntilDue <= DEADLINE_WINDOW_DAYS) {
    out.push({
      id: "quarterly-due-soon",
      severity: behind ? "critical" : slightlyBehind ? "info" : "action",
      priority: 2,
      icon: "calendar",
      title: "Quarterly Payment",
      description: input.deadlineLabel
        ? `Estimated tax payment due ${input.deadlineLabel}.`
        : `Your ${quarterLabel} estimated tax payment is coming up.`,
      cta: "View Quarterly Estimator",
      to: "/taxes#quarterly-estimator",
    });
  }

  // 2. Tax savings behind TODAY's recommended pace (never the full-quarter
  //    target — mid-quarter accumulation is normal, not an emergency).
  if (behind) {
    out.push({
      id: "tax-savings-behind",
      severity: "critical",
      priority: 3,
      icon: "alert",
      title: "Tax Savings Behind",
      description: "You're significantly behind your recommended quarterly tax savings. Review your tax savings plan.",
      cta: "Review Tax Savings Plan",
      to: "/taxes#quarterly-estimator",
    });
  } else if (slightlyBehind) {
    out.push({
      id: "tax-savings-slightly-behind",
      severity: "info",
      priority: 3,
      icon: "piggy",
      title: "Slightly Behind",
      description: stillNeedToSave > 0
        ? `Saving another ${usd(stillNeedToSave)} would bring you back on track.`
        : "You're slightly behind today's recommended savings.",
      cta: "Review Tax Savings Plan",
      to: "/taxes#quarterly-estimator",
    });
  }

  // 3. High-impact recommendations (income setup first — nothing works without it).
  if (income <= 0) {
    out.push({
      id: "add-income",
      severity: "action",
      priority: 4,
      icon: "trending-up",
      title: "Add Your Income",
      description: "Add your expected paychecks so we can project your year.",
      cta: "Add Planned Income",
      to: "/projected-income?add=1",
    });
  }

  // 4. Significant income changes.
  if (income > 0 && Math.abs(incomeChange) >= INCOME_CHANGE_THRESHOLD) {
    out.push(
      incomeChange > 0
        ? {
            id: "income-increased",
            severity: "info",
            priority: 5,
            icon: "trending-up",
            title: "Income Increased",
            description: `Your projected annual income increased by ${usd(incomeChange)}.`,
            cta: "Review Income Planner",
            to: "/projected-income",
          }
        : {
            id: "income-decreased",
            severity: "info",
            priority: 5,
            icon: "trending-down",
            title: "Income Decreased",
            description: `Your projected annual income decreased by ${usd(incomeChange)}.`,
            cta: "Review Income Planner",
            to: "/projected-income",
          },
    );
  }

  // 5. Newly available deductions — same order as the Tax Savings page.
  if (income > 0) {
    if (!input.hasRetirement) {
      out.push({
        id: "retirement",
        severity: "action",
        priority: 6,
        icon: "piggy",
        title: "Retirement Contributions",
        description: "You may lower your taxes by increasing retirement contributions.",
        cta: "Update Retirement",
        to: "/deductions#retirement",
      });
    }
    if (!input.hasHsa) {
      out.push({
        id: "hsa",
        severity: "action",
        priority: 7,
        icon: "piggy",
        title: "HSA Available",
        description: "You may qualify to fund an HSA with pre-tax dollars.",
        cta: "Set Up HSA",
        to: "/deductions#hsa",
      });
    }
    if (!input.hasHomeOffice) {
      out.push({
        id: "home-office",
        severity: "action",
        priority: 8,
        icon: "piggy",
        title: "New Deduction Available",
        description: "You may qualify for a Home Office deduction.",
        cta: "Add Home Office",
        to: "/deductions#home-office",
      });
    }
    if (!input.hasMileage) {
      out.push({
        id: "mileage",
        severity: "action",
        priority: 9,
        icon: "piggy",
        title: "Mileage Not Logged",
        description: "Logging business mileage this year could reduce your taxable income.",
        cta: "Add Mileage",
        to: "/deductions#mileage",
      });
    }
    if (!input.hasStudentLoanInterest) {
      out.push({
        id: "student-loan-interest",
        severity: "info",
        priority: 10,
        icon: "piggy",
        title: "Student Loan Interest",
        description: "You may deduct up to $2,500 of student loan interest you paid this year.",
        cta: "Enter Interest Paid",
        to: "/deductions#student-loan-interest",
      });
    }
  }

  // 6. Success confirmation when the quarter is fully covered.
  if (quarterlyRelevant && onTrack) {
    out.push({
      id: "quarterly-on-track",
      severity: "success",
      priority: 11,
      icon: "check",
      title: "Tax Savings On Track",
      description: `You're on track with your ${quarterLabel} tax savings.`,
      cta: "View Quarterly Estimator",
      to: "/taxes#quarterly-estimator",
    });
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, MAX_INSIGHTS);
}
