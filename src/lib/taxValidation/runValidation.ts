// ============================================================================
// Tax Validation Suite — scenario runner + PASS/FAIL diffing
// ============================================================================
// Purely functional: given a scenario library and a frozen baseline, run
// every scenario through the canonical engine and diff each output field.
// The runner has zero UI or storage dependencies — see TaxValidation.tsx
// for the dev-only presentation layer.
// ============================================================================

import {
  computeUnifiedTaxEstimate,
  type UnifiedTaxResult,
} from "@/lib/taxCalculationService";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";
import { makeInput } from "./defaults";
import {
  RATE_FIELDS,
  SCENARIOS,
  VALIDATED_FIELDS,
  type ScenarioTolerance,
  type TaxScenario,
  type ValidatedField,
} from "./scenarios";
import baseline from "./expected.generated.json";

const DEFAULT_DOLLAR_TOLERANCE = 1;
const DEFAULT_RATE_TOLERANCE = 0.01;

export type ScenarioValues = Record<Exclude<ValidatedField, "qbiDeduction">, number> & {
  /** §199A QBI deduction. Defaults to 0 when a baseline was generated before this field existed. */
  qbiDeduction?: number;
};

/** Extract validated values from an engine result. */
export function extractScenarioValues(result: UnifiedTaxResult): ScenarioValues {
  const { estimate, debug } = result;
  const quarterly = buildQuarterRecommendation({
    annualTaxLiability: debug.totalEstimatedTax,
    quarterMethod: "even",
  });
  return {
    agi: debug.agi,
    totalTaxableIncome: debug.totalTaxableIncome,
    federalIncomeTax: debug.federalIncomeTax,
    stateTax: debug.stateTax,
    seSocialSecurityTax: debug.seSocialSecurityTax,
    seMedicareTax: debug.seMedicareTax,
    seAdditionalMedicareTax: debug.seAdditionalMedicareTax,
    selfEmploymentTax: debug.selfEmploymentTax,
    canonicalEffectiveTaxRate: debug.canonicalEffectiveTaxRate,
    taxesAlreadyWithheldOrPaid: debug.taxesAlreadyWithheldOrPaid,
    recommendedSetAside: estimate.recommendedSetAside,
    quarterlyRecommendation: quarterly.recommendedQuarterlyPayment,
    // W-4 recommendation = per-paycheck target set-aside. Same source of truth.
    w4Recommendation: estimate.targetSetAside,
    qbiDeduction: debug.qbiDeduction ?? 0,
  };
}

/** Run a scenario through the canonical engine. */
export function runScenario(scenario: TaxScenario): {
  actual: ScenarioValues;
  result: UnifiedTaxResult;
} {
  const input = makeInput(scenario.input);
  const result = computeUnifiedTaxEstimate(input);
  return { actual: extractScenarioValues(result), result };
}

export interface FieldDiff {
  field: ValidatedField;
  expected: number;
  actual: number;
  difference: number;
  percentDifference: number; // 0..N, not %-points
  tolerance: number;
  isRate: boolean;
  pass: boolean;
}

export interface ScenarioReport {
  scenario: TaxScenario;
  status: "PASS" | "FAIL" | "NO_BASELINE";
  fields: FieldDiff[];
  failedFields: FieldDiff[];
  actual: ScenarioValues;
  expected: ScenarioValues | null;
}

function resolveTolerance(
  field: ValidatedField,
  tol?: ScenarioTolerance,
): { tolerance: number; isRate: boolean } {
  const isRate = RATE_FIELDS.has(field);
  const perField = tol?.fields?.[field];
  if (typeof perField === "number") return { tolerance: perField, isRate };
  if (isRate) return { tolerance: tol?.rate ?? DEFAULT_RATE_TOLERANCE, isRate };
  return { tolerance: tol?.dollar ?? DEFAULT_DOLLAR_TOLERANCE, isRate };
}

function diffField(
  field: ValidatedField,
  expected: number,
  actual: number,
  tol?: ScenarioTolerance,
): FieldDiff {
  const { tolerance, isRate } = resolveTolerance(field, tol);
  const difference = actual - expected;
  const percentDifference =
    Math.abs(expected) > 1e-9 ? (difference / expected) * 100 : 0;
  const pass = Math.abs(difference) <= tolerance;
  return { field, expected, actual, difference, percentDifference, tolerance, isRate, pass };
}

const BASELINE = baseline as unknown as Record<string, ScenarioValues | undefined>;

/** Diff one scenario against its frozen baseline. */
export function evaluateScenario(scenario: TaxScenario): ScenarioReport {
  const { actual } = runScenario(scenario);
  const expected = BASELINE[scenario.id] ?? null;
  if (!expected) {
    return {
      scenario,
      status: "NO_BASELINE",
      fields: [],
      failedFields: [],
      actual,
      expected: null,
    };
  }
  const fields = VALIDATED_FIELDS.map((f) =>
    diffField(f, expected[f], actual[f], scenario.tolerance),
  );
  const failedFields = fields.filter((f) => !f.pass);
  return {
    scenario,
    status: failedFields.length === 0 ? "PASS" : "FAIL",
    fields,
    failedFields,
    actual,
    expected,
  };
}

export interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  missingBaseline: number;
  reports: ScenarioReport[];
}

export function runAllScenarios(): ValidationSummary {
  const reports = SCENARIOS.map(evaluateScenario);
  return {
    total: reports.length,
    passed: reports.filter((r) => r.status === "PASS").length,
    failed: reports.filter((r) => r.status === "FAIL").length,
    missingBaseline: reports.filter((r) => r.status === "NO_BASELINE").length,
    reports,
  };
}

/** Snapshot generator used by scripts/generate-tax-validation-expected.ts. */
export function generateBaseline(): Record<string, ScenarioValues> {
  const out: Record<string, ScenarioValues> = {};
  for (const s of SCENARIOS) out[s.id] = runScenario(s).actual;
  return out;
}
