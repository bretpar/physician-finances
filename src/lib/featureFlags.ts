// Feature tier classification for future monetization
// Currently all features are unlocked — this system enables future gating
import type { FeatureKey } from "@/lib/entitlements";

export type FeatureTier = 'core' | 'advanced';

export interface FeatureDefinition {
  id: string;
  label: string;
  tier: FeatureTier;
  description: string;
}

export const FEATURES: Record<string, FeatureDefinition> = {
  // Core features
  business_activity: {
    id: 'business_activity',
    label: 'Business Activity',
    tier: 'core',
    description: 'Business income and expenses',
  },
  personal_income: {
    id: 'personal_income',
    label: 'Personal & External Income',
    tier: 'core',
    description: 'Actual income affecting taxes',
  },
  tax_estimate_actual: {
    id: 'tax_estimate_actual',
    label: 'Tax Estimate (Actual)',
    tier: 'core',
    description: 'AGI and tax calculation based on actual data',
  },
  withholding_tracking: {
    id: 'withholding_tracking',
    label: 'Withholding Tracking',
    tier: 'core',
    description: 'Track taxes withheld and tax gap',
  },
  deductions: {
    id: 'deductions',
    label: 'Deductions',
    tier: 'core',
    description: 'Mileage and business deductions',
  },
  static_tax_estimate: {
    id: 'static_tax_estimate',
    label: 'Static Tax Estimate',
    tier: 'core',
    description: 'Basic withholding recommendation from anticipated annual income',
  },

  // Advanced / Premium features
  income_planner: {
    id: 'income_planner',
    label: 'Income Planner',
    tier: 'advanced',
    description: 'Future or hypothetical income',
  },
  forecast_mode: {
    id: 'forecast_mode',
    label: 'Forecast Mode',
    tier: 'advanced',
    description: 'Include planned income in tax estimates',
  },
  dynamic_tax_recalc: {
    id: 'dynamic_tax_recalc',
    label: 'Dynamic Tax Recalculation',
    tier: 'advanced',
    description: 'Recalculate taxes with each paycheck using full-year picture',
  },
  dynamic_paycheck_recommendation: {
    id: 'dynamic_paycheck_recommendation',
    label: 'Dynamic Paycheck Recommendation',
    tier: 'advanced',
    description: 'Smart per-paycheck tax reserve recommendation after saving income',
  },
  quarterly_payment_tracking: {
    id: 'quarterly_payment_tracking',
    label: 'Quarterly Payment Tracking',
    tier: 'advanced',
    description: 'Track ahead/behind status for estimated tax payments',
  },
  recommendation_modal: {
    id: 'recommendation_modal',
    label: 'Post-Save Recommendation Modal',
    tier: 'advanced',
    description: 'Second modal showing smart tax reserve guidance after income entry',
  },
  effective_rate_forward: {
    id: 'effective_rate_forward',
    label: 'Forward-Looking Effective Rate',
    tier: 'advanced',
    description: 'Effective tax rate including projections',
  },
  scenario_modeling: {
    id: 'scenario_modeling',
    label: 'Scenario Modeling',
    tier: 'advanced',
    description: 'What-if tax scenarios',
  },
  premium_visibility: {
    id: 'premium_visibility',
    label: 'Premium Feature Visibility',
    tier: 'advanced',
    description: 'Show premium feature indicators and upgrade prompts',
  },
};

/**
 * Check if a feature is enabled.
 * Currently all features are enabled — this function exists so that
 * a future subscription system can gate advanced features by returning false.
 */
export function isFeatureEnabled(_featureId: string): boolean {
  // All features unlocked for now — flip to false for advanced tier gating
  return true;
}

export function getFeatureTier(featureId: string): FeatureTier | undefined {
  return FEATURES[featureId]?.tier;
}

/**
 * Check if a feature is a premium/advanced feature.
 * Useful for conditionally showing premium badges or upgrade prompts in the future.
 */
export function isPremiumFeature(featureId: string): boolean {
  return FEATURES[featureId]?.tier === 'advanced';
}

export const ENTITLEMENT_FEATURE_KEYS: FeatureKey[] = [
  "basicWithholdingGuide",
  "advancedWithholdingGuide",
  "spouseW2Support",
  "multipleW2Jobs",
  "businessIncomeTracking",
  "businessExpenseTracking",
  "mileageDeduction",
  "homeOfficeDeduction",
  "quarterlyTaxPlanner",
  "scenarioPlanner",
  "reportsExport",
  "advancedTaxOverview",
  "premiumEducation",
  "customW2BusinessSplit",
  "detailedReports",
];
