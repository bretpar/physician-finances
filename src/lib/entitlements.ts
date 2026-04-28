import type { HouseholdIncomeStreams } from "@/hooks/useTaxSettings";

export type UserType =
  | "W2_ONLY"
  | "W2_PLUS_1099"
  | "FULLY_1099"
  | "W2_PLUS_K1"
  | "W2_PLUS_SCORP"
  | "W2_PLUS_RENTAL"
  | "MULTI_STREAM_HOUSEHOLD"
  | "INVESTMENT_HEAVY";

export type SubscriptionTier = "FREE" | "PREMIUM";

export type FeatureKey =
  | "basicWithholdingGuide"
  | "advancedWithholdingGuide"
  | "spouseW2Support"
  | "multipleW2Jobs"
  | "businessIncomeTracking"
  | "businessExpenseTracking"
  | "mileageDeduction"
  | "homeOfficeDeduction"
  | "quarterlyTaxPlanner"
  | "scenarioPlanner"
  | "reportsExport"
  | "advancedTaxOverview"
  | "premiumEducation"
  | "customW2BusinessSplit"
  | "detailedReports"
  | "basicTaxOverview"
  | "basicPaycheckTracking"
  | "basic1099Tracking"
  | "basicTaxGapEstimate"
  | "basicExpenseTracking"
  | "basicTaxSavingsEstimate";

export type FeatureAccessStatus = "available" | "locked" | "hidden";

export interface FeatureAccess {
  key: FeatureKey;
  status: FeatureAccessStatus;
  requiredTier?: SubscriptionTier;
}

export interface FeatureAccessContext {
  userType: UserType;
  subscriptionTier: SubscriptionTier;
}

export const DEFAULT_SUBSCRIPTION_TIER: SubscriptionTier = "FREE";

export function deriveUserTypeFromIncomeStreams(streams?: HouseholdIncomeStreams): UserType {
  if (!streams) return "MULTI_STREAM_HOUSEHOLD";

  const hasW2Income = streams.w2Income || streams.spouseW2Income || streams.additionalW2Job;
  const has1099Income = streams.business1099Income;
  const hasK1Income = streams.k1PartnershipIncome;
  const hasSCorpIncome = streams.sCorpIncome;
  const hasRentalIncome = streams.rentalIncome;
  const hasInvestmentIncome = streams.investmentIncome;
  const hasOtherIncome = streams.otherIncome;
  const hasFutureBusinessModule = hasK1Income || hasSCorpIncome || hasRentalIncome;
  const hasComplexStream = hasFutureBusinessModule || hasInvestmentIncome || hasOtherIncome;

  if (hasW2Income && !has1099Income && !hasComplexStream) return "W2_ONLY";
  if (hasW2Income && has1099Income && !hasComplexStream) return "W2_PLUS_1099";
  if (!hasW2Income && has1099Income && !hasComplexStream) return "FULLY_1099";
  if (!hasW2Income && hasInvestmentIncome && !has1099Income && !hasFutureBusinessModule) return "INVESTMENT_HEAVY";

  return "MULTI_STREAM_HOUSEHOLD";
}

const FREE_FEATURES_BY_USER_TYPE: Record<UserType, FeatureKey[]> = {
  W2_ONLY: ["basicWithholdingGuide", "basicTaxOverview", "basicPaycheckTracking"],
  W2_PLUS_1099: ["basicWithholdingGuide", "basic1099Tracking", "basicTaxGapEstimate"],
  FULLY_1099: ["basic1099Tracking", "basicExpenseTracking", "basicTaxSavingsEstimate"],
  W2_PLUS_K1: ["basicWithholdingGuide", "basicTaxOverview", "basicTaxGapEstimate"],
  W2_PLUS_SCORP: ["basicWithholdingGuide", "basicTaxOverview", "basicTaxGapEstimate"],
  W2_PLUS_RENTAL: ["basicWithholdingGuide", "basicTaxOverview", "basicTaxGapEstimate"],
  MULTI_STREAM_HOUSEHOLD: ["basicWithholdingGuide", "basicTaxOverview", "basic1099Tracking", "basicTaxGapEstimate"],
  INVESTMENT_HEAVY: ["basicTaxOverview", "basicTaxGapEstimate"],
};

const PREMIUM_FEATURES_BY_USER_TYPE: Record<UserType, FeatureKey[]> = {
  W2_ONLY: [
    "advancedWithholdingGuide",
    "spouseW2Support",
    "multipleW2Jobs",
    "scenarioPlanner",
    "detailedReports",
    "reportsExport",
    "premiumEducation",
    "advancedTaxOverview",
  ],
  W2_PLUS_1099: [
    "advancedWithholdingGuide",
    "businessIncomeTracking",
    "businessExpenseTracking",
    "mileageDeduction",
    "homeOfficeDeduction",
    "quarterlyTaxPlanner",
    "customW2BusinessSplit",
    "scenarioPlanner",
    "detailedReports",
    "reportsExport",
    "premiumEducation",
    "advancedTaxOverview",
  ],
  FULLY_1099: [
    "businessIncomeTracking",
    "businessExpenseTracking",
    "mileageDeduction",
    "homeOfficeDeduction",
    "quarterlyTaxPlanner",
    "scenarioPlanner",
    "detailedReports",
    "reportsExport",
    "premiumEducation",
    "advancedTaxOverview",
  ],
  W2_PLUS_K1: ["advancedWithholdingGuide", "scenarioPlanner", "detailedReports", "reportsExport", "premiumEducation", "advancedTaxOverview"],
  W2_PLUS_SCORP: ["advancedWithholdingGuide", "scenarioPlanner", "detailedReports", "reportsExport", "premiumEducation", "advancedTaxOverview"],
  W2_PLUS_RENTAL: ["advancedWithholdingGuide", "scenarioPlanner", "detailedReports", "reportsExport", "premiumEducation", "advancedTaxOverview"],
  MULTI_STREAM_HOUSEHOLD: [
    "advancedWithholdingGuide",
    "spouseW2Support",
    "multipleW2Jobs",
    "businessIncomeTracking",
    "businessExpenseTracking",
    "mileageDeduction",
    "homeOfficeDeduction",
    "quarterlyTaxPlanner",
    "customW2BusinessSplit",
    "scenarioPlanner",
    "detailedReports",
    "reportsExport",
    "premiumEducation",
    "advancedTaxOverview",
  ],
  INVESTMENT_HEAVY: ["scenarioPlanner", "detailedReports", "reportsExport", "premiumEducation", "advancedTaxOverview"],
};

export const ALL_ENTITLEMENT_FEATURES: FeatureKey[] = Array.from(
  new Set([...Object.values(FREE_FEATURES_BY_USER_TYPE).flat(), ...Object.values(PREMIUM_FEATURES_BY_USER_TYPE).flat()]),
);

export function getFeatureAccess(userType: UserType, subscriptionTier: SubscriptionTier): Record<FeatureKey, FeatureAccess> {
  const freeFeatures = new Set(FREE_FEATURES_BY_USER_TYPE[userType]);
  const premiumFeatures = new Set(PREMIUM_FEATURES_BY_USER_TYPE[userType]);

  return ALL_ENTITLEMENT_FEATURES.reduce(
    (access, key) => {
      const isFree = freeFeatures.has(key);
      const isPremium = premiumFeatures.has(key);
      access[key] = {
        key,
        status: isFree || (subscriptionTier === "PREMIUM" && isPremium) ? "available" : isPremium ? "locked" : "hidden",
        requiredTier: isPremium && !isFree ? "PREMIUM" : undefined,
      };
      return access;
    },
    {} as Record<FeatureKey, FeatureAccess>,
  );
}

export function canAccessFeature(featureKey: FeatureKey, context: FeatureAccessContext): boolean {
  return getFeatureAccess(context.userType, context.subscriptionTier)[featureKey]?.status === "available";
}

export function isFeatureLocked(featureKey: FeatureKey, context: FeatureAccessContext): boolean {
  return getFeatureAccess(context.userType, context.subscriptionTier)[featureKey]?.status === "locked";
}
