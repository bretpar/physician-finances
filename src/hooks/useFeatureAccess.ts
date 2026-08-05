import { useMemo } from "react";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useAccountRole } from "@/hooks/useAccountRole";
import { accountRoleToSubscriptionTier, type AccountRole } from "@/lib/roles";
import {
  canAccessFeature,
  deriveUserTypeFromIncomeStreams,
  getFeatureAccess,
  isFeatureLocked,
  type FeatureAccess,
  type FeatureKey,
  type SubscriptionTier,
  type UserType,
} from "@/lib/entitlements";

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
    can: (key) => canAccessFeature(key, { userType, subscriptionTier }),
    isLocked: (key) => isFeatureLocked(key, { userType, subscriptionTier }),
    isLoading: roleLoading || settingsLoading,
  };
}
