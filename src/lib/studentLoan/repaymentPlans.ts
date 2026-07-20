/**
 * Backward-compatible facade over the new rules-registry-driven engine.
 *
 * DO NOT add plan math here. All rules live in `src/lib/studentLoan/rules/`.
 * These exports exist so pre-existing consumers (StudentLoans page, MFS
 * comparison) keep compiling without touching every callsite.
 */

import {
  PLANS,
  PLAN_MAP,
  listPlans,
  REGISTRY_VERSION,
} from "./rules/plans";
import { computePovertyGuideline, latestPovertyYear } from "./rules/povertyGuidelines";
import type { PlanRule } from "./rules/types";

export {
  amortizedMonthlyPayment,
  monthsToPayoff,
} from "./computePlanPayment";
export { REGISTRY_VERSION };

export type RepaymentPlanId = string;
export type RepaymentPlanFamily = PlanRule["family"] | "other";

export interface RepaymentPlanDefinition {
  id: string;
  label: string;
  family: RepaymentPlanFamily;
  status: PlanRule["status"];
  termMonths: number;
  idrPercent?: number;
  idrPovertyMultiplier?: number;
  forgivenessYears?: number;
  tooltip: string;
  sourceUrl: string;
  sourceUpdatedAt: string;
  rulesVersion: string;
  verification: PlanRule["verification"];
}

function toDefinition(p: PlanRule): RepaymentPlanDefinition {
  return {
    id: p.id,
    label: p.displayName,
    family: p.family,
    status: p.status,
    termMonths: p.termMonths ?? p.tieredTerm?.[0]?.termMonths ?? 0,
    idrPercent: p.idrPercent,
    idrPovertyMultiplier: p.discretionary?.povertyMultiplier,
    forgivenessYears: p.forgivenessMonths ? Math.round(p.forgivenessMonths / 12) : undefined,
    tooltip: p.tooltip,
    sourceUrl: p.sourceUrl,
    sourceUpdatedAt: p.sourceUpdatedAt,
    rulesVersion: p.rulesVersion,
    verification: p.verification,
  };
}

export const REPAYMENT_PLANS: Record<string, RepaymentPlanDefinition> = Object.fromEntries(
  PLANS.map((p) => [p.id, toDefinition(p)]),
);

/** All plans (including closed/historical) for admin displays. */
export const ALL_REPAYMENT_PLAN_LIST: RepaymentPlanDefinition[] = PLANS.map(toDefinition);

/** Only plans a borrower could currently enroll in or continue on. */
export const REPAYMENT_PLAN_LIST: RepaymentPlanDefinition[] = listPlans().map(toDefinition);

/** Currently-available (new-enrollment) plans only. */
export const CURRENT_REPAYMENT_PLAN_LIST: RepaymentPlanDefinition[] = listPlans({ status: "current" }).map(toDefinition);

/** Poverty helper preserved for legacy consumers. Uses latest 48-state guideline. */
export function federalPovertyLine(familySize: number): number {
  const { amount } = computePovertyGuideline(familySize, latestPovertyYear(), "contiguous_48_dc");
  return amount;
}

export { PLAN_MAP };
