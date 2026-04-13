// Feature tier classification for future monetization
// Currently all features are unlocked — this system enables future gating

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

  // Advanced features
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
    description: 'Recalculate taxes using projected income',
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
};

/**
 * Check if a feature is enabled.
 * Currently all features are enabled — this function exists so that
 * a future subscription system can gate advanced features by returning false.
 */
export function isFeatureEnabled(_featureId: string): boolean {
  // All features unlocked for now
  return true;
}

export function getFeatureTier(featureId: string): FeatureTier | undefined {
  return FEATURES[featureId]?.tier;
}
