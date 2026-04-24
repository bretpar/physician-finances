/**
 * Savings Rate Selection
 * --------------------------------------------------------------------------
 * Single source of truth for "what % should this paycheck/income entry set
 * aside?" — split cleanly by income bucket so Personal Income and Business
 * Income never pull from the wrong rate.
 *
 *   Personal bucket = federal income tax + employee SS + employee Medicare
 *                     + personal state income tax (if enabled)
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
import type { TaxEstimate } from "@/lib/taxEngine";
import { SE_TAX_RATE, SE_INCOME_FACTOR } from "@/lib/taxEngine";
import { isW2FilingType } from "@/lib/filingTypes";

export type IncomeBucket = "personal" | "business";

// Employee-side payroll tax rates (FICA). These are the *additions* on top of
// the federal income tax rate for a W-2 paycheck guide.
const EMPLOYEE_SS_RATE = 6.2;     // %
const EMPLOYEE_MEDICARE_RATE = 1.45; // %

export interface SavingsRateSettingsLike {
  withholdingMethod?: string | null;
  manualEffectiveTaxRate?: number | null;
  stateTaxEnabled?: boolean | null;
  personalStateTaxMode?: "none" | "flat_rate" | "annual_estimate" | string | null;
  personalStateTaxRate?: number | null;
  businessStateTaxEnabled?: boolean | null;
  businessStateTaxRate?: number | null;
}

export interface SavingsRateInput {
  incomeBucket: IncomeBucket;
  /** UI income type ('W2' | '1099' | 'K1' | 'paycheck' | etc.). Optional. */
  incomeType?: string;
  taxSettings: SavingsRateSettingsLike | null | undefined;
  actualEstimate: TaxEstimate | null | undefined;
  forecastEstimate: TaxEstimate | null | undefined;
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

const ZERO_COMPONENTS = {
  federal: 0,
  employeeSocialSecurity: 0,
  employeeMedicare: 0,
  selfEmployment: 0,
  personalState: 0,
  businessState: 0,
};

/** Personal state income tax % only when state tax is enabled and a flat rate
 *  is configured. (annual_estimate mode is dollar-based, not a rate, so it
 *  doesn't fold into a per-paycheck percentage.) */
function getPersonalStateRate(s: SavingsRateSettingsLike): number {
  if (!s?.stateTaxEnabled) return 0;
  if (s.personalStateTaxMode !== "flat_rate") return 0;
  return Math.max(0, Number(s.personalStateTaxRate || 0));
}

/** Business state / B&O rate, only when both master + business switches are on. */
function getBusinessStateRate(s: SavingsRateSettingsLike): number {
  if (!s?.stateTaxEnabled || !s?.businessStateTaxEnabled) return 0;
  return Math.max(0, Number(s.businessStateTaxRate || 0));
}

/** SE tax effective rate as % of gross self-employment income (after the
 *  92.35% factor). Used as the business bucket's pass-through payroll add-on
 *  for 1099/K-1/Schedule-C income. */
const SE_EFFECTIVE_RATE_PCT = SE_TAX_RATE * SE_INCOME_FACTOR * 100; // ≈ 14.13

export function getSavingsRateForIncomeBucket(
  input: SavingsRateInput,
): SavingsRateResult {
  const { incomeBucket, incomeType, taxSettings } = input;
  const settings = taxSettings ?? {};
  const method = (settings.withholdingMethod || "dynamic_actual") as SavingsRateResult["method"];
  const isW2 = incomeType ? isW2FilingType(incomeType) : incomeBucket === "personal";

  // ── Federal portion (varies by method) ─────────────────────────────────
  let federal = 0;
  if (method === "flat_estimate") {
    federal = Math.max(0, Number(settings.manualEffectiveTaxRate ?? 0));
  } else if (method === "dynamic_planner") {
    federal = Math.max(0, Number(input.forecastEstimate?.federalEffectiveRate ?? 0));
  } else {
    federal = Math.max(0, Number(input.actualEstimate?.federalEffectiveRate ?? 0));
  }

  const components = { ...ZERO_COMPONENTS, federal };

  if (incomeBucket === "personal") {
    // Personal paycheck guide — employee-side payroll taxes for W-2 checks
    // plus personal state income tax. NEVER includes SE / B&O / business state.
    if (isW2) {
      components.employeeSocialSecurity = EMPLOYEE_SS_RATE;
      components.employeeMedicare = EMPLOYEE_MEDICARE_RATE;
    }
    components.personalState = getPersonalStateRate(settings);
  } else {
    // Business / pass-through reserve target — federal + SE + business state.
    // No employee-side payroll (the payer didn't withhold any).
    components.selfEmployment = SE_EFFECTIVE_RATE_PCT;
    components.businessState = getBusinessStateRate(settings);
  }

  const rate =
    components.federal +
    components.employeeSocialSecurity +
    components.employeeMedicare +
    components.selfEmployment +
    components.personalState +
    components.businessState;

  const label =
    method === "flat_estimate"
      ? `Flat ${federal.toFixed(1)}% federal estimate`
      : method === "dynamic_planner"
      ? "Based on actual + planned income"
      : "Based on combined actual income";

  return {
    rate: Math.round(rate * 100) / 100,
    components,
    method,
    label,
  };
}
