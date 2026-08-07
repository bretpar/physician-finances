/**
 * Central, code-only feature registry.
 *
 * One source of truth for "which release level does this gated feature require".
 * Deliberately NOT database-backed: no rollout percentages, no per-user
 * overrides, no editing. Admin > Features renders this read-only.
 *
 * Access levels reuse the account-role hierarchy from `@/lib/roles`.
 */

import { hasAtLeastRole, isAccountRole, type AccountRole } from "@/lib/roles";
import type { FeatureKey } from "@/lib/entitlements";

/** `disabled` means no role gets the feature. */
export type FeatureAccessLevel = AccountRole | "disabled";

export type FeatureStatus = "active" | "disabled";

export interface FeatureRegistryEntry {
  key: FeatureKey;
  name: string;
  description: string;
  minimumRole: FeatureAccessLevel;
  status: FeatureStatus;
}

export const FEATURE_ACCESS_LEVEL_LABEL: Record<FeatureAccessLevel, string> = {
  free: "Free",
  premium: "Premium",
  premium_beta: "Premium Beta",
  developer: "Developer",
  disabled: "Disabled",
};

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  active: "Active",
  disabled: "Disabled",
};

/**
 * Mirrors the gates already enforced by `getFeatureAccess()` in entitlements.ts.
 * No new restrictions were introduced here.
 */
export const FEATURE_REGISTRY: FeatureRegistryEntry[] = [
  // ---- Free tier ----
  {
    key: "basicWithholdingGuide",
    name: "Basic Withholding Guide",
    description: "Simple paycheck withholding guidance from anticipated income",
    minimumRole: "free",
    status: "active",
  },
  {
    key: "basicTaxOverview",
    name: "Basic Tax Overview",
    description: "Headline tax estimate and summary cards",
    minimumRole: "free",
    status: "active",
  },
  {
    key: "basicPaycheckTracking",
    name: "Basic Paycheck Tracking",
    description: "Record W-2 paychecks and withholding",
    minimumRole: "free",
    status: "active",
  },
  {
    key: "basic1099Tracking",
    name: "Basic 1099 Tracking",
    description: "Record 1099 / contract income",
    minimumRole: "free",
    status: "active",
  },
  {
    key: "basicTaxGapEstimate",
    name: "Basic Tax Gap Estimate",
    description: "Estimate the gap between taxes owed and taxes withheld",
    minimumRole: "free",
    status: "active",
  },
  {
    key: "basicExpenseTracking",
    name: "Basic Expense Tracking",
    description: "Record business expenses",
    minimumRole: "free",
    status: "active",
  },
  {
    key: "basicTaxSavingsEstimate",
    name: "Basic Tax Savings Estimate",
    description: "Estimated savings from tracked deductions",
    minimumRole: "free",
    status: "active",
  },

  // ---- Premium tier ----
  {
    key: "advancedWithholdingGuide",
    name: "Advanced Withholding Guide",
    description: "Dynamic per-paycheck withholding and W-4 adjustment guidance",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "spouseW2Support",
    name: "Spouse W-2 Support",
    description: "Track a spouse's W-2 income and withholding",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "multipleW2Jobs",
    name: "Multiple W-2 Jobs",
    description: "Track more than one W-2 employer",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "businessIncomeTracking",
    name: "Business Income Tracking",
    description: "Business income ledger and profit reporting",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "businessExpenseTracking",
    name: "Business Expense Tracking",
    description: "Categorized business expense ledger",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "mileageDeduction",
    name: "Mileage Deduction",
    description: "Mileage log and standard-rate deduction",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "homeOfficeDeduction",
    name: "Home Office Deduction",
    description: "Simplified and actual-expense home office deduction",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "quarterlyTaxPlanner",
    name: "Quarterly Tax Planner",
    description: "Quarterly estimated payment planning and pace tracking",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "customW2BusinessSplit",
    name: "Custom W-2 / Business Split",
    description: "Manually allocate withholding between W-2 and business income",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "scenarioPlanner",
    name: "Scenario Planner",
    description: "What-if income and tax scenario modeling",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "detailedReports",
    name: "Detailed Reports",
    description: "Monthly and annual detailed tax reporting",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "reportsExport",
    name: "Reports Export",
    description: "CSV and PDF export of reports and tax prep packets",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "premiumEducation",
    name: "Premium Education",
    description: "In-depth tax explanation and education content",
    minimumRole: "premium",
    status: "active",
  },
  {
    key: "advancedTaxOverview",
    name: "Advanced Tax Overview",
    description: "Full tax breakdown, AGI reconciliation, and math detail",
    minimumRole: "premium",
    status: "active",
  },
];

const REGISTRY_BY_KEY: Record<string, FeatureRegistryEntry> = FEATURE_REGISTRY.reduce(
  (acc, entry) => {
    acc[entry.key] = entry;
    return acc;
  },
  {} as Record<string, FeatureRegistryEntry>,
);

export function getFeatureDefinition(key: string): FeatureRegistryEntry | undefined {
  return REGISTRY_BY_KEY[key];
}

/** True only for keys that exist in the registry and are not disabled. */
export function isFeatureRegistered(key: string): boolean {
  const entry = REGISTRY_BY_KEY[key];
  return !!entry && entry.status === "active" && entry.minimumRole !== "disabled";
}

/**
 * Registry-level role gate. Fails closed: unknown keys and disabled features
 * are denied for every role, including developer.
 */
export function entryAllowsRole(entry: FeatureRegistryEntry | undefined, role: AccountRole | null | undefined): boolean {
  if (!entry) return false;
  if (entry.status === "disabled" || entry.minimumRole === "disabled") return false;
  if (!isAccountRole(role)) return false; // fail closed on missing/unknown role
  return hasAtLeastRole(role, entry.minimumRole);
}

export function roleMeetsFeatureMinimum(role: AccountRole | null | undefined, key: string): boolean {
  return entryAllowsRole(REGISTRY_BY_KEY[key], role);
}

/** Filters by feature name or stable key (case-insensitive). */
export function filterFeatures(entries: FeatureRegistryEntry[], search: string): FeatureRegistryEntry[] {
  const q = search.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(q) || e.key.toLowerCase().includes(q));
}
