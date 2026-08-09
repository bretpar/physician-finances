import { z } from "zod";

/**
 * Onboarding plan selection.
 *
 * The selected plan writes to the SAME canonical account role that
 * `useAccountRole()` reads (server-resolved). `tax_settings.subscription_tier`
 * is display metadata only and is never the access authority.
 *
 * Only the two public tiers are selectable here — `premium_beta` and
 * `developer` are internal roles and must never be exposed in onboarding.
 */
export type SelectablePlan = "free" | "premium";

export interface PlanOption {
  plan: SelectablePlan;
  title: string;
  subtitle: string;
  badge?: string;
  benefits: string[];
  chooseLabel: string;
}

export const PLAN_OPTIONS: PlanOption[] = [
  {
    plan: "free",
    title: "Free",
    subtitle: "Track and understand",
    benefits: ["Income & expense tracking", "Basic tax estimate", "Basic tax savings", "Core dashboard"],
    chooseLabel: "Choose Free",
  },
  {
    plan: "premium",
    title: "Premium",
    subtitle: "Plan and optimize",
    badge: "Best for planning",
    benefits: ["Income Planner", "Advanced tax planning", "W-4 & quarterly planning", "Personalized recommendations"],
    chooseLabel: "Choose Premium",
  },
];

export const selectablePlanSchema = z.enum(["free", "premium"]);

export function isSelectablePlan(value: unknown): value is SelectablePlan {
  return selectablePlanSchema.safeParse(value).success;
}

/**
 * Future checkout hook. Payment processing is intentionally not implemented
 * yet, so no plan requires checkout today. When paid Premium launches, return
 * `true` for "premium" here and have the caller run checkout BEFORE the role is
 * assigned — the UI already branches on this instead of assuming Premium is
 * free to select.
 */
export function planRequiresCheckout(_plan: SelectablePlan): boolean {
  return false;
}
