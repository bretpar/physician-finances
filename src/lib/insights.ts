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
  /** Quarter coverage ratio (0-1+) from buildQuarterRecommendation. */
  savingsCoverageRatio: number;
  /** max(0, recommendedPaymentToMake - savedThisQuarter) from buildQuarterRecommendation. */
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

/** Coverage below this share of the recommended quarterly set-aside is "behind". */
export const COVERAGE_TARGET = 0.9;
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
  const behind = quarterlyRelevant && coverage < COVERAGE_TARGET;

  const out: Insight[] = [];

  // 1. Deadlines.
  if (quarterlyRelevant && behind && daysUntilDue < 0) {
    out.push({
      id: "quarterly-overdue",
      severity: "critical",
      priority: 1,
      icon: "alert",
      title: `${quarterLabel} Payment Overdue`,
      description: `Your ${quarterLabel} estimated payment deadline has passed and your set-aside is short.`,
      cta: "Review Taxes",
      to: "/taxes",
    });
  } else if (quarterlyRelevant && daysUntilDue >= 0 && daysUntilDue <= DEADLINE_WINDOW_DAYS) {
    out.push({
      id: "quarterly-due-soon",
      severity: behind ? "critical" : "action",
      priority: 2,
      icon: "calendar",
      title: "Quarterly Payment",
      description: input.deadlineLabel
        ? `Estimated tax payment due ${input.deadlineLabel}.`
        : `Your ${quarterLabel} estimated tax payment is coming up.`,
      cta: "View",
      to: "/taxes",
    });
  }

  // 2. Tax savings behind schedule.
  if (behind && stillNeedToSave > 0) {
    out.push({
      id: "tax-savings-behind",
      severity: "critical",
      priority: 3,
      icon: "alert",
      title: "Tax Savings Behind",
      description: `You're currently ${usd(stillNeedToSave)} behind your recommended tax reserve.`,
      cta: "Review Taxes",
      to: "/taxes",
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
      cta: "View Planner",
      to: "/projected-income",
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
            cta: "View Planner",
            to: "/projected-income",
          }
        : {
            id: "income-decreased",
            severity: "info",
            priority: 5,
            icon: "trending-down",
            title: "Income Decreased",
            description: `Your projected annual income decreased by ${usd(incomeChange)}.`,
            cta: "View Planner",
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
        cta: "Review",
        to: "/deductions",
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
        cta: "Review",
        to: "/deductions",
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
        cta: "Review",
        to: "/deductions",
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
        cta: "Review",
        to: "/deductions",
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
        cta: "Review",
        to: "/deductions",
      });
    }
  }

  // 6. Success confirmation when the quarter is fully covered.
  if (quarterlyRelevant && !behind) {
    out.push({
      id: "quarterly-on-track",
      severity: "success",
      priority: 11,
      icon: "check",
      title: "Tax Savings On Track",
      description: `You've reserved your full recommended ${quarterLabel} tax savings.`,
      cta: "View",
      to: "/taxes",
    });
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, MAX_INSIGHTS);
}
