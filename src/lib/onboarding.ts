import type { HouseholdIncomeStreams, WithholdingMethod } from "@/hooks/useTaxSettings";
import type { FeatureKey, SubscriptionTier } from "@/lib/entitlements";
import type { FilingType } from "@/lib/filingTypes";

export type IncomeProfileType = "w2_only" | "w2_plus_business" | "business_only";
export type TaxRecommendationMethod = "flat_rate" | "dynamic_actual" | "dynamic_planner";
export type DeductionStrategy = "standard" | "itemized" | "not_sure";
export type OnboardingSubscriptionTier = "free" | "premium";

export type OnboardingCompanyType = "w2" | "1099" | "k1";

export interface OnboardingCompanyDraft {
  name: string;
  type: OnboardingCompanyType;
  description?: string;
}

export interface EnabledIncomeSources {
  w2: boolean;
  form1099: boolean;
  k1: boolean;
}

export interface UserOnboardingSettings {
  onboardingComplete: boolean | null;
  onboardingBannerDismissed: boolean;
  firstName: string;
  incomeProfileType: IncomeProfileType;
  enabledIncomeSources: EnabledIncomeSources;
  enabledPersonalIncomeTypes: string[];
  taxRecommendationMethod: TaxRecommendationMethod;
  flatFederalRate?: number | null;
  flatStateRate?: number | null;
  deductionStrategy: DeductionStrategy;
  enabledDeductionTypes: string[];
  subscriptionTier: OnboardingSubscriptionTier;
}

export const DEFAULT_ONBOARDING_SETTINGS: UserOnboardingSettings = {
  onboardingComplete: null,
  onboardingBannerDismissed: false,
  firstName: "",
  incomeProfileType: "w2_plus_business",
  enabledIncomeSources: { w2: true, form1099: true, k1: true },
  enabledPersonalIncomeTypes: [],
  taxRecommendationMethod: "dynamic_planner",
  flatFederalRate: null,
  flatStateRate: null,
  deductionStrategy: "standard",
  enabledDeductionTypes: [],
  subscriptionTier: "premium",
};

export function incomeProfileToSources(profile: IncomeProfileType): EnabledIncomeSources {
  if (profile === "w2_only") return { w2: true, form1099: false, k1: false };
  if (profile === "business_only") return { w2: false, form1099: true, k1: true };
  return { w2: true, form1099: true, k1: true };
}

export function getAllowedCompanyTypes(incomeProfileType: IncomeProfileType): OnboardingCompanyType[] {
  if (incomeProfileType === "w2_only") return ["w2"];
  if (incomeProfileType === "business_only") return ["1099", "k1"];
  return ["w2", "1099", "k1"];
}

export function onboardingCompanyTypeToFilingType(type: OnboardingCompanyType): FilingType {
  if (type === "w2") return "w2";
  if (type === "k1") return "k1_partnership";
  return "1099_schedule_c";
}

export function incomeSourcesToHouseholdStreams(sources: EnabledIncomeSources, personalTypes: string[] = []): HouseholdIncomeStreams {
  return {
    w2Income: sources.w2,
    spouseW2Income: false,
    additionalW2Job: false,
    business1099Income: sources.form1099,
    k1PartnershipIncome: sources.k1,
    sCorpIncome: false,
    rentalIncome: personalTypes.includes("rental"),
    investmentIncome: personalTypes.some((type) => ["investment", "interest", "dividend", "capital_gains"].includes(type)),
    otherIncome: personalTypes.some((type) => ["retirement", "other"].includes(type)),
  };
}

export function taxRecommendationToWithholdingMethod(method: TaxRecommendationMethod): WithholdingMethod {
  return method === "flat_rate" ? "flat_estimate" : method;
}

export function subscriptionTierToEntitlementTier(tier?: OnboardingSubscriptionTier | string | null): SubscriptionTier {
  return tier === "premium" || tier === "PREMIUM" ? "PREMIUM" : "FREE";
}

export type AccessFeatureKey =
  | FeatureKey
  | "basic_dashboard"
  | "basic_income_tracking"
  | "basic_tax_estimate"
  | "basic_deduction_tracking"
  | "full_income_planner"
  | "quarterly_tax_planning"
  | "advanced_tax_recommendations"
  | "business_expense_tracking"
  | "k1_income"
  | "multi_income_streams"
  | "advanced_deductions"
  | "reports_exports"
  | "tax_explanation_cards";

const FREE_FEATURES: AccessFeatureKey[] = [
  "basic_dashboard",
  "basic_income_tracking",
  "basic_tax_estimate",
  "basic_deduction_tracking",
  "basicWithholdingGuide",
  "basicTaxOverview",
  "basicPaycheckTracking",
  "basic1099Tracking",
  "basicTaxGapEstimate",
  "basicExpenseTracking",
  "basicTaxSavingsEstimate",
];

export function hasFeatureAccess(user: { subscriptionTier?: OnboardingSubscriptionTier | SubscriptionTier | string | null } | null | undefined, featureKey: AccessFeatureKey) {
  if (subscriptionTierToEntitlementTier(user?.subscriptionTier) === "PREMIUM") return true;
  return FREE_FEATURES.includes(featureKey);
}