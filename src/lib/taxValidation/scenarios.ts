// ============================================================================
// Tax Validation Suite — regression scenario library
// ============================================================================
// Data-driven. Add a new scenario by appending to SCENARIOS; no changes to
// the validation runner are needed. Expected values live in the frozen
// baseline (expected.generated.json) so any calculation drift trips a
// failing scenario immediately.
//
// Each scenario is defined by:
//   • id / name / description / category  (metadata for the report UI)
//   • input (Partial<UnifiedTaxInput>)    (only the fields that differ
//                                          from DEFAULT_INPUT)
//   • tolerance                           (per-field dollar/rate overrides;
//                                          defaults to $1 / 0.01 pp)
// ============================================================================

import type { UnifiedTaxInput } from "@/lib/taxCalculationService";

export interface ScenarioTolerance {
  /** Dollar tolerance for currency fields (default $1). */
  dollar?: number;
  /** Percentage-point tolerance for rate fields (default 0.01). */
  rate?: number;
  /** Per-field overrides (dollar tolerance). */
  fields?: Partial<Record<ValidatedField, number>>;
}

export interface TaxScenario {
  id: string;
  name: string;
  description: string;
  category:
    | "w2_only"
    | "1099_only"
    | "mixed"
    | "multi_business"
    | "capital_gains"
    | "high_income"
    | "low_income"
    | "negative_profit";
  input: Partial<UnifiedTaxInput>;
  tolerance?: ScenarioTolerance;
}

/** Fields validated against the baseline. Extend here to widen coverage. */
export const VALIDATED_FIELDS = [
  "agi",
  "totalTaxableIncome",
  "federalIncomeTax",
  "stateTax",
  "seSocialSecurityTax",
  "seMedicareTax",
  "seAdditionalMedicareTax",
  "selfEmploymentTax",
  "canonicalEffectiveTaxRate",
  "taxesAlreadyWithheldOrPaid",
  "recommendedSetAside",
  "quarterlyRecommendation",
  "w4Recommendation",
  "qbiDeduction",
] as const;

export type ValidatedField = (typeof VALIDATED_FIELDS)[number];

/** Human labels for the report UI. */
export const FIELD_LABELS: Record<ValidatedField, string> = {
  agi: "AGI",
  totalTaxableIncome: "Taxable Income",
  federalIncomeTax: "Federal Income Tax",
  stateTax: "State Income Tax",
  seSocialSecurityTax: "Social Security Tax",
  seMedicareTax: "Medicare Tax",
  seAdditionalMedicareTax: "Additional Medicare Tax",
  selfEmploymentTax: "Self-Employment Tax",
  canonicalEffectiveTaxRate: "Effective Tax Rate",
  taxesAlreadyWithheldOrPaid: "Taxes Already Withheld",
  recommendedSetAside: "Recommended Reserve",
  quarterlyRecommendation: "Quarterly Recommendation",
  w4Recommendation: "W-4 Recommendation",
  qbiDeduction: "QBI Deduction (§199A)",
};

/** Fields expressed as percentage points (not dollars). */
export const RATE_FIELDS: ReadonlySet<ValidatedField> = new Set([
  "canonicalEffectiveTaxRate",
]);

export const SCENARIOS: TaxScenario[] = [
  {
    id: "w2-only-single-100k",
    name: "W-2 only — single filer, $100k",
    description:
      "Single W-2 employee, $100k wages, standard deduction, no dependents, moderate withholding.",
    category: "w2_only",
    input: {
      personalIncome: 100_000,
      personalW2: 100_000,
      personalFederalWithheld: 12_000,
      filingStatus: "single",
    },
  },
  {
    id: "w2-only-mfj-250k",
    name: "W-2 only — MFJ, $250k household",
    description:
      "MFJ, single-earner $250k W-2 with $30k pre-tax 401(k), two qualifying children.",
    category: "w2_only",
    input: {
      personalIncome: 250_000,
      personalW2: 250_000,
      personalPreTax: 10_000,
      personalRetirement: 23_500,
      personalFederalWithheld: 35_000,
      filingStatus: "married_filing_jointly",
      qualifyingChildrenCount: 2,
    },
  },
  {
    id: "1099-only-single-150k",
    name: "1099 only — single Schedule C, $150k",
    description:
      "Single filer, $150k Schedule C gross, $20k business expenses, $2k mileage, quarterly payments made.",
    category: "1099_only",
    input: {
      businessIncome: 150_000,
      seEligibleBusinessIncome: 150_000,
      seEligibleBusinessExpenses: 20_000,
      seEligibleMileageDeduction: 2_000,
      businessExpenses: 20_000,
      mileageDeduction: 2_000,
      actualEstimatedPaymentsMade: 20_000,
      filingStatus: "single",
    },
  },
  {
    id: "w2-plus-1099-mfj-300k",
    name: "W-2 + 1099 — MFJ physician side gig",
    description:
      "MFJ, $220k W-2 plus $80k 1099 side income, $8k business expenses, $12k SEP contribution.",
    category: "mixed",
    input: {
      personalIncome: 220_000,
      personalW2: 220_000,
      personalFederalWithheld: 32_000,
      personalRetirement: 5_000,
      businessIncome: 80_000,
      seEligibleBusinessIncome: 80_000,
      seEligibleBusinessExpenses: 8_000,
      businessExpenses: 8_000,
      businessRetirement: 12_000,
      actualEstimatedPaymentsMade: 6_000,
      filingStatus: "married_filing_jointly",
    },
  },
  {
    id: "multi-business-1099-plus-k1",
    name: "Multiple businesses — 1099 + K-1 partnership",
    description:
      "Single filer with $90k Schedule C ($15k expenses) and $60k K-1 partnership ($5k expenses).",
    category: "multi_business",
    input: {
      // Both are SE-eligible; aggregated at the caller layer.
      businessIncome: 150_000,
      seEligibleBusinessIncome: 150_000,
      seEligibleBusinessExpenses: 20_000,
      businessExpenses: 20_000,
      filingStatus: "single",
      actualEstimatedPaymentsMade: 12_000,
    },
  },
  {
    id: "capital-gains-mixed",
    name: "Capital gains — W-2 + long-term gains + dividends",
    description:
      "MFJ, $180k W-2 plus $40k long-term capital gains / qualified dividends.",
    category: "capital_gains",
    input: {
      personalIncome: 220_000,
      personalW2: 180_000,
      personalNonW2Income: 40_000,
      longTermCapitalGains: 40_000,
      personalFederalWithheld: 24_000,
      filingStatus: "married_filing_jointly",
    },
  },
  {
    id: "high-income-physician",
    name: "High-income physician — mixed with state tax",
    description:
      "MFJ, $450k W-2 (with 401k + HSA), $120k 1099 Schedule C, LTCG $25k, flat 5% state tax.",
    category: "high_income",
    input: {
      personalIncome: 450_000,
      personalW2: 450_000,
      personalPreTax: 8_300,
      personalRetirement: 23_500,
      personalFederalWithheld: 90_000,
      personalStateWithheld: 20_000,
      businessIncome: 120_000,
      seEligibleBusinessIncome: 120_000,
      seEligibleBusinessExpenses: 15_000,
      businessExpenses: 15_000,
      businessRetirement: 25_000,
      ownerHealthcare: 18_000,
      longTermCapitalGains: 25_000,
      personalNonW2Income: 25_000,
      actualEstimatedPaymentsMade: 25_000,
      filingStatus: "married_filing_jointly",
      qualifyingChildrenCount: 2,
      stateIncomeTaxEnabled: true,
      stateTaxEnabled: true,
      personalStateTaxMode: "flat_rate",
      personalStateTaxRate: 5,
    },
  },
  {
    id: "low-income-taxpayer",
    name: "Low-income taxpayer — below standard deduction",
    description:
      "Single filer, $12k W-2, standard deduction wipes out taxable income. Withholding = refund.",
    category: "low_income",
    input: {
      personalIncome: 12_000,
      personalW2: 12_000,
      personalFederalWithheld: 500,
      filingStatus: "single",
    },
  },
  {
    id: "negative-schedule-c",
    name: "Negative Schedule C — business loss offsets W-2",
    description:
      "Single filer, $80k W-2, $30k Schedule C with $50k expenses (net -$20k loss).",
    category: "negative_profit",
    input: {
      personalIncome: 80_000,
      personalW2: 80_000,
      personalFederalWithheld: 9_000,
      businessIncome: 30_000,
      seEligibleBusinessIncome: 30_000,
      seEligibleBusinessExpenses: 50_000,
      businessExpenses: 50_000,
      filingStatus: "single",
    },
  },
];
