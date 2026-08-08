import { useMemo } from "react";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useAccountRole } from "@/hooks/useAccountRole";
import { accountRoleToSubscriptionTier, type AccountRole } from "@/lib/roles";
import { roleMeetsFeatureMinimum } from "@/lib/featureRegistry";
import {
  ALL_ENTITLEMENT_FEATURES,
  canAccessFeature,
  deriveUserTypeFromIncomeStreams,
  getFeatureAccess,
  isFeatureLocked,
  type FeatureAccess,
  type FeatureKey,
  type SubscriptionTier,
  type UserType,
} from "@/lib/entitlements";

/**
 * Staged-release features are not part of the FREE/PREMIUM tier matrix; their
 * access comes solely from the registry's `minimumRole`
 * (developer → premium_beta → premium).
 */
const TIER_MATRIX_KEYS = new Set<string>(ALL_ENTITLEMENT_FEATURES);
export function isStagedReleaseFeature(key: FeatureKey): boolean {
  return !TIER_MATRIX_KEYS.has(key);
}

export interface FeatureAccessResult {
  role: AccountRole;
  /** Derived from the account role only — never from tax_settings.subscription_tier. */
  subscriptionTier: SubscriptionTier;
  isPremium: boolean;
  userType: UserType;
  featureAccess: Record<FeatureKey, FeatureAccess>;
  can: (key: FeatureKey) => boolean;
  isLocked: (key: FeatureKey) => boolean;
  isLoading: boolean;
}

/**
 * Centralized feature-visibility hook. Every gating check in the app must go
 * through this so account role and subscription tier cannot drift.
 *
 * @param userTypeOverride optional user type (e.g. a Settings preview of a
 *   pending income-stream draft) — entitlement tier still comes from the role.
 */
export function useFeatureAccess(userTypeOverride?: UserType): FeatureAccessResult {
  const { data: taxSettings, isLoading: settingsLoading } = useTaxSettings();
  const { role, isLoading: roleLoading } = useAccountRole();

  const subscriptionTier = accountRoleToSubscriptionTier(role) as SubscriptionTier;
  const userType = userTypeOverride ?? deriveUserTypeFromIncomeStreams(taxSettings?.householdIncomeStreams);

  const featureAccess = useMemo(() => getFeatureAccess(userType, subscriptionTier), [userType, subscriptionTier]);

  return {
    role,
    subscriptionTier,
    isPremium: subscriptionTier === "PREMIUM",
    userType,
    featureAccess,
    can: (key) =>
      isStagedReleaseFeature(key)
        ? roleMeetsFeatureMinimum(role, key)
        : canAccessFeature(key, { userType, subscriptionTier }),
    isLocked: (key) => (isStagedReleaseFeature(key) ? false : isFeatureLocked(key, { userType, subscriptionTier })),
    isLoading: roleLoading || settingsLoading,
  };
}
