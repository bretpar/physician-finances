/**
 * SALT + itemized deductions (developer MVP).
 *
 * Pure calculation module — no persistence, no React. The tax engine keeps its
 * single flat `itemizedDeductionAmount` input; this module is the ONLY place
 * that derives that number from per-category SALT inputs.
 *
 * 2026 rules implemented here:
 *  - SALT = property taxes + greater of (state income tax OR state/local sales
 *    tax) + personal property tax.
 *  - SALT cap: $40,400 generally, $20,200 married filing separately.
 *  - Cap phase-down: reduced by 30% of MAGI above $505,000
 *    ($252,500 MFS), floored at the statutory minimum ($10,000 / $5,000 MFS).
 *  - Total itemized = capped SALT + other itemized deductions.
 *  - Standard vs itemized: the greater of the two is always applied.
 */

import { STANDARD_DEDUCTION, type FilingStatus } from "@/lib/taxBrackets";

export const SALT_CAP_2026 = 40_400;
export const SALT_CAP_2026_MFS = 20_200;
export const SALT_FLOOR_2026 = 10_000;
export const SALT_FLOOR_2026_MFS = 5_000;
export const SALT_PHASEDOWN_THRESHOLD_2026 = 505_000;
export const SALT_PHASEDOWN_THRESHOLD_2026_MFS = 252_500;
export const SALT_PHASEDOWN_RATE = 0.3;

/** §163(h)(3) acquisition-debt limits for post-2017 mortgages. */
export const MORTGAGE_DEBT_LIMIT = 750_000;
export const MORTGAGE_DEBT_LIMIT_MFS = 375_000;

const nonNeg = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const isMfs = (filingStatus: FilingStatus) => filingStatus === "married_filing_separately";

export type StateTaxEntryMode = "estimate" | "manual";

export interface ItemizedDeductionInputs {
  /** Real-estate / property taxes paid. */
  propertyTax: number;
  /** How the state income tax figure is sourced. */
  stateIncomeTaxMode: StateTaxEntryMode;
  /** Engine-estimated state income tax (used when mode = "estimate"). */
  stateIncomeTaxEstimate: number;
  /** User-entered state income tax (used when mode = "manual"). */
  stateIncomeTaxManual: number;
  /** Base state/local general sales tax (table estimate or actual). */
  salesTaxBase: number;
  /** Sales tax on large purchases (car, boat, home materials). */
  salesTaxLargePurchases: number;
  /** Personal property tax (vehicle registration value-based portion). */
  personalPropertyTax: number;
  /** Advanced override: force the sales-tax path even if income tax is larger. */
  forceSalesTaxElection: boolean;
  /**
   * @deprecated IGNORED. A client-controlled value must never raise (or lower)
   * the statutory SALT cap. Kept only so persisted values type-check.
   */
  saltCapOverride?: number | null;

  /** Qualified home mortgage interest paid this year. */
  mortgageInterest?: number;
  /**
   * Average mortgage balance for the year. When provided and above the
   * acquisition-debt limit, interest is prorated to the deductible share.
   * Leave blank/undefined to deduct the full interest entered.
   */
  mortgageBalance?: number | null;
  /** Other itemized deductions (charity, etc.). */
  otherItemizedDeductions: number;
  filingStatus: FilingStatus;
  /** Modified AGI driving the cap phase-down. */
  magi: number;
}

export interface ItemizedDeductionResult {
  stateIncomeTax: number;
  salesTaxTotal: number;
  /** Which SALT election won. */
  electedStateTaxType: "income" | "sales";
  electedStateTaxAmount: number;
  propertyTax: number;
  personalPropertyTax: number;
  /** SALT before the cap. */
  saltBeforeCap: number;
  /** Statutory cap for the filing status. */
  baseCap: number;
  /** Cap reduction from the MAGI phase-down. */
  phaseDownAmount: number;
  /** Cap actually applied after phase-down / floor / override. */
  effectiveCap: number;
  /** SALT allowed after the cap. */
  saltDeduction: number;
  /** Amount of SALT lost to the cap. */
  saltDisallowed: number;
  /** Mortgage interest entered. */
  mortgageInterest: number;
  /** Deductible share of mortgage interest after the debt limit. */
  mortgageInterestDeductible: number;
  /** Interest disallowed by the acquisition-debt limit. */
  mortgageInterestDisallowed: number;
  /** Debt limit used for the mortgage interest proration. */
  mortgageDebtLimit: number;
  otherItemizedDeductions: number;
  /** Capped SALT + mortgage interest + other itemized. */
  totalItemized: number;
}

export function computeItemizedDeductions(input: ItemizedDeductionInputs): ItemizedDeductionResult {
  const mfs = isMfs(input.filingStatus);

  const stateIncomeTax =
    input.stateIncomeTaxMode === "manual"
      ? nonNeg(input.stateIncomeTaxManual)
      : nonNeg(input.stateIncomeTaxEstimate);
  const salesTaxTotal = nonNeg(input.salesTaxBase) + nonNeg(input.salesTaxLargePurchases);

  const useSales = input.forceSalesTaxElection || salesTaxTotal > stateIncomeTax;
  const electedStateTaxAmount = useSales ? salesTaxTotal : stateIncomeTax;

  const propertyTax = nonNeg(input.propertyTax);
  const personalPropertyTax = nonNeg(input.personalPropertyTax);
  const saltBeforeCap = propertyTax + electedStateTaxAmount + personalPropertyTax;

  const baseCap = mfs ? SALT_CAP_2026_MFS : SALT_CAP_2026;
  const floor = mfs ? SALT_FLOOR_2026_MFS : SALT_FLOOR_2026;
  const threshold = mfs ? SALT_PHASEDOWN_THRESHOLD_2026_MFS : SALT_PHASEDOWN_THRESHOLD_2026;

  const excessMagi = Math.max(0, nonNeg(input.magi) - threshold);
  const rawPhaseDown = excessMagi * SALT_PHASEDOWN_RATE;
  // The phase-down can never push the cap below the statutory floor.
  const phaseDownAmount = Math.min(rawPhaseDown, Math.max(0, baseCap - floor));
  const phasedCap = Math.max(floor, baseCap - phaseDownAmount);

  const effectiveCap =
    input.saltCapOverride !== null && input.saltCapOverride !== undefined && Number.isFinite(Number(input.saltCapOverride))
      ? Math.max(0, Number(input.saltCapOverride))
      : phasedCap;

  const saltDeduction = Math.min(saltBeforeCap, effectiveCap);
  const otherItemizedDeductions = nonNeg(input.otherItemizedDeductions);

  const mortgageInterest = nonNeg(input.mortgageInterest);
  const mortgageDebtLimit = mfs ? MORTGAGE_DEBT_LIMIT_MFS : MORTGAGE_DEBT_LIMIT;
  const mortgageBalance = nonNeg(input.mortgageBalance);
  const mortgageInterestDeductible =
    mortgageBalance > mortgageDebtLimit
      ? mortgageInterest * (mortgageDebtLimit / mortgageBalance)
      : mortgageInterest;

  return {
    stateIncomeTax,
    salesTaxTotal,
    electedStateTaxType: useSales ? "sales" : "income",
    electedStateTaxAmount,
    propertyTax,
    personalPropertyTax,
    saltBeforeCap,
    baseCap,
    phaseDownAmount,
    effectiveCap,
    saltDeduction,
    saltDisallowed: Math.max(0, saltBeforeCap - saltDeduction),
    mortgageInterest,
    mortgageInterestDeductible,
    mortgageInterestDisallowed: Math.max(0, mortgageInterest - mortgageInterestDeductible),
    mortgageDebtLimit,
    otherItemizedDeductions,
    totalItemized: saltDeduction + mortgageInterestDeductible + otherItemizedDeductions,
  };
}

export interface DeductionSelection {
  deductionType: "standard" | "itemized";
  standardDeduction: number;
  itemizedDeduction: number;
  /** max(standard, itemized) */
  deductionApplied: number;
  /** Extra deduction gained by itemizing (0 when the standard deduction wins). */
  itemizingBenefit: number;
}

/** Always applies the greater of the standard and itemized deductions. */
export function selectDeduction(params: {
  filingStatus: FilingStatus;
  itemizedTotal: number;
  standardDeductionOverride?: number | null;
}): DeductionSelection {
  const standardDeduction =
    params.standardDeductionOverride !== null && params.standardDeductionOverride !== undefined
      ? Math.max(0, Number(params.standardDeductionOverride))
      : STANDARD_DEDUCTION[params.filingStatus];
  const itemizedDeduction = nonNeg(params.itemizedTotal);
  const useItemized = itemizedDeduction > standardDeduction;

  return {
    deductionType: useItemized ? "itemized" : "standard",
    standardDeduction,
    itemizedDeduction,
    deductionApplied: useItemized ? itemizedDeduction : standardDeduction,
    itemizingBenefit: Math.max(0, itemizedDeduction - standardDeduction),
  };
}

/**
 * Bridge between saved tax settings and the engine's flat deduction inputs.
 *
 * When itemized deductions are turned off, saved `deductionType` /
 * `itemizedDeductionAmount` behavior is preserved exactly. When on, SALT is
 * computed here and the greater of standard vs itemized is applied.
 */
export function resolveItemizedDeductionInputs(params: {
  rates: {
    filingStatus: string;
    deductionType: "standard" | "itemized";
    itemizedDeductionAmount: number;
    standardDeductionOverride?: number | null;
    itemizedDeductionsEnabled?: boolean;
    saltPropertyTax?: number;
    saltStateIncomeTaxMode?: StateTaxEntryMode;
    saltStateIncomeTaxManual?: number;
    saltSalesTaxBase?: number;
    saltSalesTaxLargePurchases?: number;
    saltPersonalPropertyTax?: number;
    saltForceSalesTaxElection?: boolean;
    saltCapOverride?: number | null;
    itemizedOtherDeductions?: number;
    itemizedMortgageInterest?: number;
    itemizedMortgageBalance?: number | null;
    personalStateTaxAnnualEstimate?: number;
  };
  /** Fallback state income tax estimate when no annual estimate is saved. */
  stateWithheldEstimate: number;
  magiApprox: number;
  /**
   * Authoritative feature-access decision for the `itemizedDeductions` feature.
   * When explicitly `false`, saved itemized settings must NOT affect the tax
   * calculation, even if `itemizedDeductionsEnabled` is still persisted.
   * Undefined = no gating information supplied (pure-math callers/tests).
   */
  hasFeatureAccess?: boolean;
}): { deductionType: "standard" | "itemized"; itemizedDeductionAmount: number } {
  const { rates } = params;
  if (!rates.itemizedDeductionsEnabled || params.hasFeatureAccess === false) {
    return {
      deductionType: rates.deductionType,
      itemizedDeductionAmount: rates.itemizedDeductionAmount,
    };
  }

  const filingStatus = rates.filingStatus as FilingStatus;
  const savedStateEstimate = nonNeg(rates.personalStateTaxAnnualEstimate);
  const itemized = computeItemizedDeductions({
    propertyTax: nonNeg(rates.saltPropertyTax),
    stateIncomeTaxMode: rates.saltStateIncomeTaxMode === "manual" ? "manual" : "estimate",
    stateIncomeTaxEstimate: savedStateEstimate > 0 ? savedStateEstimate : nonNeg(params.stateWithheldEstimate),
    stateIncomeTaxManual: nonNeg(rates.saltStateIncomeTaxManual),
    salesTaxBase: nonNeg(rates.saltSalesTaxBase),
    salesTaxLargePurchases: nonNeg(rates.saltSalesTaxLargePurchases),
    personalPropertyTax: nonNeg(rates.saltPersonalPropertyTax),
    forceSalesTaxElection: !!rates.saltForceSalesTaxElection,
    saltCapOverride: rates.saltCapOverride ?? null,
    otherItemizedDeductions: nonNeg(rates.itemizedOtherDeductions),
    mortgageInterest: nonNeg(rates.itemizedMortgageInterest),
    mortgageBalance: rates.itemizedMortgageBalance ?? null,
    filingStatus,
    magi: params.magiApprox,
  });

  const selection = selectDeduction({
    filingStatus,
    itemizedTotal: itemized.totalItemized,
    standardDeductionOverride: rates.standardDeductionOverride ?? null,
  });

  // The engine applies `itemizedDeductionAmount` verbatim when the type is
  // "itemized", so only send that when itemizing actually wins.
  return selection.deductionType === "itemized"
    ? { deductionType: "itemized", itemizedDeductionAmount: selection.deductionApplied }
    : { deductionType: "standard", itemizedDeductionAmount: 0 };
}
