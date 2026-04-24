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
import { isSelfEmployedFilingType } from "@/lib/filingTypes";

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
  /** Human label for UI. */
  label: string;
}

export type WithholdingProfileRateSource = "flat_estimate" | "dynamic_actual" | "dynamic_planner";

export interface WithholdingProfileRateResult {
  methodUsed: WithholdingProfileRateSource;
  /** Dynamic ordinary-income recommendation base: federal + personal state income tax ÷ total return income. */
  federalProfileRate: number;
  /** All-inclusive display rate: total estimated annual tax ÷ total return income. */
  canonicalEffectiveTaxRate: number;
  source: WithholdingProfileRateSource;
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
  const ordinaryIncomeTax = Math.max(0, Number(estimate?.federalTax || 0) + Number(estimate?.personalStateTax || 0));
  const income = totalReturnIncome(estimate);
  if (income <= 0) return 0;
  return roundRate((ordinaryIncomeTax / income) * 100);
}

function canonicalEffectiveTaxRate(estimate: TaxEstimate | null | undefined): number {
  const totalTax = Math.max(0, Number(estimate?.totalTaxLiability || 0));
  const income = totalReturnIncome(estimate);
  if (income <= 0) return 0;
  return roundRate((totalTax / income) * 100);
}

export function getSelectedWithholdingProfileRate(input: {
  taxSettings: SavingsRateSettingsLike | null | undefined;
  actualEstimate: TaxEstimate | null | undefined;
  forecastEstimate: TaxEstimate | null | undefined;
}): WithholdingProfileRateResult {
  const settings = input.taxSettings ?? {};
  const method = (settings.withholdingMethod || "dynamic_actual") as WithholdingProfileRateSource;

  if (method === "flat_estimate") {
    const federalProfileRate = roundRate(settings.manualEffectiveTaxRate ?? 0);
    return {
      methodUsed: "flat_estimate",
      federalProfileRate,
      canonicalEffectiveTaxRate: federalProfileRate,
      source: "flat_estimate",
      label: `Flat ${federalProfileRate.toFixed(1)}% federal estimate`,
    };
  }

  const dynamicEstimate = input.forecastEstimate;
  const federalProfileRate = dynamicOrdinaryIncomeProfileRate(dynamicEstimate);
  const allInclusiveRate = canonicalEffectiveTaxRate(dynamicEstimate);

  if (method === "dynamic_planner") {
    return {
      methodUsed: "dynamic_planner",
      federalProfileRate,
      canonicalEffectiveTaxRate: allInclusiveRate,
      source: "dynamic_planner",
      label: "Based on actual + future income",
    };
  }

  return {
    methodUsed: "dynamic_actual",
    federalProfileRate,
    canonicalEffectiveTaxRate: allInclusiveRate,
    source: "dynamic_actual",
    label: "Based on actual + future income",
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

function getSelfEmploymentRate(estimate: TaxEstimate | null | undefined): number {
  const totalIncome = Math.max(0, Number(estimate?.totalIncome || 0));
  const seTax = Math.max(0, Number(estimate?.seTax?.total || 0));
  if (totalIncome > 0 && seTax > 0) return (seTax / totalIncome) * 100;
  return SE_EFFECTIVE_RATE_PCT;
}

export function getSavingsRateForIncomeBucket(
  input: SavingsRateInput,
): SavingsRateResult {
  const { incomeBucket, incomeType, taxSettings } = input;
  const settings = taxSettings ?? {};
  const profile = getSelectedWithholdingProfileRate({
    taxSettings: settings,
    actualEstimate: input.actualEstimate,
    forecastEstimate: input.forecastEstimate,
  });
  const method = profile.methodUsed;
  const selectedEstimate = method === "flat_estimate" ? input.actualEstimate : input.forecastEstimate;

  // ── Federal portion (shared selected withholding profile rate) ──────────
  const federal = profile.federalProfileRate;

  const components = { ...ZERO_COMPONENTS, federal };

  if (incomeBucket === "personal") {
    // Personal paycheck guide — selected federal profile rate only.
    // Employee SS/Medicare reduce the recommendation as withheld credits;
    // state taxes, business state tax, and SE never apply here.
  } else {
    // Business / pass-through reserve target — federal + SE + business state.
    // No employee-side payroll (the payer didn't withhold any).
    if (!incomeType || isSelfEmployedFilingType(incomeType)) {
      components.selfEmployment = getSelfEmploymentRate(selectedEstimate);
    }
    components.businessState = getBusinessStateRate(settings, input);
  }

  const rate =
    components.federal +
    components.employeeSocialSecurity +
    components.employeeMedicare +
    components.selfEmployment +
    components.personalState +
    components.businessState;

  return {
    rate: Math.round(rate * 100) / 100,
    components,
    method,
    label: profile.label,
  };
}
