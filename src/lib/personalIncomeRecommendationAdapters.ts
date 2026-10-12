/**
 * Personal Income recommendation adapters.
 *
 * The preview (useWithholdingRecommendation), the save/reminder
 * (useIncomeRecommendation) and the reopened edit all price the SAME paycheck,
 * so they must receive the SAME inputs — in particular the same catch-up
 * eligibility. These pure builders are the only place the page turns form
 * values into recommendation inputs.
 */
import { isW2FilingType } from "@/lib/filingTypes";

const isW2 = (t: string) => t === "w2_user" || t === "w2_partner" || isW2FilingType(t);

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

export interface PersonalPaycheckForm {
  gross_amount: unknown;
  income_type: string;
  federal_withholding: unknown;
  ss_withholding: unknown;
  medicare_withholding: unknown;
  state_withholding: unknown;
  retirement_pretax: unknown;
  deductions_pre_tax: unknown;
  healthcare_deduction: unknown;
  hsa_contribution: unknown;
}

export interface PersonalPaycheckContext {
  /** Canonical total federal payroll taxes (income tax + SS + Medicare). */
  totalFederalPayrollTaxes: number;
  stateIncomeTaxEnabled: boolean;
  isFutureOpportunity: boolean;
}

/**
 * Existing W-2 paycheck-target policy: a W-2 paycheck target never absorbs a
 * prior quarterly/annual shortfall, and historical paychecks never receive
 * catch-up. Other personal types keep the live quarter catch-up (undefined).
 */
export function resolvePersonalPaycheckCatchUp(
  incomeType: string,
  isFutureOpportunity: boolean,
): number | undefined {
  if (!isFutureOpportunity) return 0;
  if (isW2(incomeType)) return 0;
  return undefined;
}

function shared(form: PersonalPaycheckForm, ctx: PersonalPaycheckContext) {
  const ss = num(form.ss_withholding);
  const medicare = num(form.medicare_withholding);
  return {
    grossIncome: num(form.gross_amount),
    incomeBucket: "personal" as const,
    ficaWithheldNotCredited: ss + medicare,
    retirement401k: num(form.retirement_pretax),
    preTaxDeductions:
      num(form.deductions_pre_tax) + num(form.healthcare_deduction) + num(form.hsa_contribution),
    isFutureOpportunity: ctx.isFutureOpportunity,
    catchUpAmount: resolvePersonalPaycheckCatchUp(form.income_type, ctx.isFutureOpportunity),
  };
}

/** Input for useWithholdingRecommendation (Add / reopened Edit preview). */
export function buildPersonalPreviewInput(form: PersonalPaycheckForm, ctx: PersonalPaycheckContext) {
  return {
    ...shared(form, ctx),
    incomeType: isW2(form.income_type) ? "w2" : form.income_type,
    taxesAlreadyWithheld: ctx.totalFederalPayrollTaxes,
    stateWithholding: ctx.stateIncomeTaxEnabled ? num(form.state_withholding) : 0,
  };
}

/** Input for useIncomeRecommendation (save + after-save reminder). */
export function buildPersonalSaveInput(form: PersonalPaycheckForm, ctx: PersonalPaycheckContext) {
  return {
    ...shared(form, ctx),
    incomeType: form.income_type,
    federalWithheld: ctx.totalFederalPayrollTaxes,
    stateWithheld: ctx.stateIncomeTaxEnabled ? num(form.state_withholding) : 0,
    stateTaxIncludedInTarget: ctx.stateIncomeTaxEnabled,
  };
}

/** Display value for a recommendation: exact canonical amount to the cent (never whole dollars). */
export function recommendationDisplayCents(amount: number): number {
  return Math.max(0, Math.round(amount * 100) / 100);
}
