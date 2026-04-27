/**
 * Savings Rate Selection
 * --------------------------------------------------------------------------
 * Single source of truth for "what % should this paycheck/income entry set
 * aside?" — split cleanly by income bucket so Personal Income and Business
 * Income never pull from the wrong rate.
 *
 *   Personal bucket = federal income tax + personal state income tax only.
 *                     Payroll withholdings are credits against the recommendation.
 *                     ⛔ never B&O / business state / SE add-on
 *
 *   Business bucket = federal income tax + SE tax (or pass-through payroll add-on)
 *                     + business state / B&O (if enabled)
 *                     ⛔ never employee-side payroll only
 *
 * The three withholding methods (flat_estimate / dynamic_actual /
 * dynamic_planner) all flow through the same selection logic so the bucket
 * separation is consistent regardless of which method the user picked.
 */
import { SE_TAX_RATE, SE_INCOME_FACTOR, type TaxEstimate } from "@/lib/taxEngine";
import { isW2FilingType, normalizeFilingType } from "@/lib/filingTypes";

export type IncomeBucket = "personal" | "business";

export interface SavingsRateSettingsLike {
  withholdingMethod?: string | null;
  manualEffectiveTaxRate?: number | null;
  stateIncomeTaxEnabled?: boolean | null;
  /** Backwards-compatible alias for personal state income tax only. */
  stateTaxEnabled?: boolean | null;
  personalStateTaxMode?: "none" | "flat_rate" | "annual_estimate" | string | null;
  personalStateTaxRate?: number | null;
  businessStateTaxEnabled?: boolean | null;
  businessStateTaxRate?: number | null;
  businessStateTaxApplicationMode?: "all_business" | "selected" | string | null;
  businessStateTaxCompanyIds?: string[] | null;
}

export interface SavingsRateInput {
  incomeBucket: IncomeBucket;
  /** UI income type ('W2' | '1099' | 'K1' | 'paycheck' | etc.). Optional. */
  incomeType?: string;
  taxSettings: SavingsRateSettingsLike | null | undefined;
  actualEstimate: TaxEstimate | null | undefined;
  forecastEstimate: TaxEstimate | null | undefined;
  companyId?: string | null;
  applyBusinessStateTax?: boolean | null;
  includeSETaxInRecommendation?: boolean | null;
  /** Explicit override for K-1 guaranteed payments or other SE-taxable edge cases. */
  isSelfEmploymentTaxable?: boolean | null;
}

export interface SavingsRateResult {
  /** Total recommended set-aside rate (percent, e.g. 17.5). */
  rate: number;
  /** Component breakdown (percent values) for transparency / tooltips. */
  components: {
    federal: number;
    employeeSocialSecurity: number;
    employeeMedicare: number;
    selfEmployment: number;
    personalState: number;
    businessState: number;
  };
  /** Which method drove the federal portion. */
  method: "flat_estimate" | "dynamic_actual" | "dynamic_planner";
  baseRateSource: "manualEffectiveTaxRate" | "federalEffectiveRate" | "effectiveRate";
  /** Human label for UI. */
  label: string;
}

export type WithholdingProfileRateSource = "flat_estimate" | "dynamic_actual" | "dynamic_planner";

export interface WithholdingProfileRateResult {
  methodUsed: WithholdingProfileRateSource;
  /** Dynamic business recommendation base: federal income tax only ÷ total return income. */
  federalProfileRate: number;
  /** All-inclusive display rate: total estimated annual tax ÷ total return income. */
  canonicalEffectiveTaxRate: number;
  source: WithholdingProfileRateSource;
  estimateSource: "manual" | "actual-only" | "forecast";
  label: string;
}

const ZERO_COMPONENTS = {
  federal: 0,
  employeeSocialSecurity: 0,
  employeeMedicare: 0,
  selfEmployment: 0,
  personalState: 0,
  businessState: 0,
};

const roundRate = (n: number) => Math.round(Math.max(0, Number(n) || 0) * 100) / 100;

function totalReturnIncome(estimate: TaxEstimate | null | undefined): number {
  return Math.max(0, Number(estimate?.totalReturnIncomeBeforeAdjustments || estimate?.totalIncome || 0));
}

function dynamicOrdinaryIncomeProfileRate(estimate: TaxEstimate | null | undefined): number {
  if (estimate?.federalEffectiveRate != null) return roundRate(estimate.federalEffectiveRate);
  const ordinaryIncomeTax = Math.max(0, Number(estimate?.federalTax || 0) + Number(estimate?.personalStateTax || 0));
  const income = totalReturnIncome(estimate);
  if (income <= 0) return 0;
  return roundRate((ordinaryIncomeTax / income) * 100);
}

function canonicalEffectiveTaxRate(estimate: TaxEstimate | null | undefined): number {
  if (estimate?.effectiveRate != null) return roundRate(estimate.effectiveRate);
  const totalTax = Math.max(0, Number(estimate?.totalTaxLiability || 0));
  const income = totalReturnIncome(estimate);
  if (income <= 0) return 0;
  return roundRate((totalTax / income) * 100);
}

function isSETaxableIncome(input: SavingsRateInput): boolean {
  if (input.includeSETaxInRecommendation === false) return false;
  if (input.isSelfEmploymentTaxable != null) return !!input.isSelfEmploymentTaxable;
  const filing = normalizeFilingType(input.incomeType);
  if (filing === "1099_schedule_c") return true;
  if (filing === "k1_partnership") return true;
  return false;
}

export function getBaseRateForIncomeType(input: SavingsRateInput): SavingsRateResult {
  const { incomeBucket, incomeType, taxSettings } = input;
  const settings = taxSettings ?? {};
  const profile = getSelectedWithholdingProfileRate({
    taxSettings: settings,
    actualEstimate: input.actualEstimate,
    forecastEstimate: input.forecastEstimate,
  });
  const method = profile.methodUsed;
  const filing = normalizeFilingType(incomeType);
  const useAllInclusiveBase = incomeBucket === "personal" || isW2FilingType(filing);
  const baseRate = method === "flat_estimate"
    ? profile.federalProfileRate
    : useAllInclusiveBase
      ? profile.canonicalEffectiveTaxRate
      : profile.federalProfileRate;
  const baseRateSource = method === "flat_estimate"
    ? "manualEffectiveTaxRate"
    : useAllInclusiveBase
      ? "effectiveRate"
      : "federalEffectiveRate";

  const components = { ...ZERO_COMPONENTS, federal: baseRate };
  if (incomeBucket === "business" && !useAllInclusiveBase) {
    if (isSETaxableIncome(input)) components.selfEmployment = getSelfEmploymentRate();
    components.businessState = getBusinessStateRate(settings, input);
  }

  const rate = roundRate(
    components.federal +
    components.employeeSocialSecurity +
    components.employeeMedicare +
    components.selfEmployment +
    components.personalState +
    components.businessState,
  );

  return { rate, components, method, baseRateSource, label: profile.label };
}

export function getSelectedWithholdingProfileRate(input: {
  taxSettings: SavingsRateSettingsLike | null | undefined;
  actualEstimate: TaxEstimate | null | undefined;
  forecastEstimate: TaxEstimate | null | undefined;
}): WithholdingProfileRateResult {
  const settings = input.taxSettings ?? {};
  const method = (settings.withholdingMethod || "dynamic_planner") as WithholdingProfileRateSource;

  if (method === "flat_estimate") {
    const federalProfileRate = roundRate(settings.manualEffectiveTaxRate ?? 0);
    return {
      methodUsed: "flat_estimate",
      federalProfileRate,
      canonicalEffectiveTaxRate: federalProfileRate,
      source: "flat_estimate",
      estimateSource: "manual",
      label: "Using manual tax rate",
    };
  }

  const dynamicEstimate = method === "dynamic_planner" ? input.forecastEstimate : input.actualEstimate;
  const federalProfileRate = dynamicOrdinaryIncomeProfileRate(dynamicEstimate);
  const allInclusiveRate = canonicalEffectiveTaxRate(dynamicEstimate);

  if (method === "dynamic_planner") {
    return {
      methodUsed: "dynamic_planner",
      federalProfileRate,
      canonicalEffectiveTaxRate: allInclusiveRate,
      source: "dynamic_planner",
      estimateSource: "forecast",
      label: "Includes planned/future income",
    };
  }

  return {
    methodUsed: "dynamic_actual",
    federalProfileRate,
    canonicalEffectiveTaxRate: allInclusiveRate,
    source: "dynamic_actual",
    estimateSource: "actual-only",
    label: "Based on actual income only",
  };
}

/** Business state / B&O rate. Independent from the personal state income switch. */
function getBusinessStateRate(s: SavingsRateSettingsLike, input: SavingsRateInput): number {
  if (!s?.businessStateTaxEnabled) return 0;
  if (input.applyBusinessStateTax === false) return 0;
  if (s.businessStateTaxApplicationMode === "selected") {
    if (!input.companyId) return 0;
    if (!s.businessStateTaxCompanyIds?.includes(input.companyId)) return 0;
  }
  return Math.max(0, Number(s.businessStateTaxRate || 0));
}

/** SE tax effective rate as % of gross self-employment income (after the
 *  92.35% factor). Used as the business bucket's pass-through payroll add-on
 *  for 1099/K-1/Schedule-C income. */
const SE_EFFECTIVE_RATE_PCT = SE_TAX_RATE * SE_INCOME_FACTOR * 100; // ≈ 14.13

function getSelfEmploymentRate(): number {
  return SE_EFFECTIVE_RATE_PCT;
}

export function getSavingsRateForIncomeBucket(
  input: SavingsRateInput,
): SavingsRateResult {
  return getBaseRateForIncomeType(input);
}
