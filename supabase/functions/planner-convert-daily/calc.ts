// deno-lint-ignore-file no-explicit-any
// Pure calculation helpers for the daily conversion job (unit-tested from src/test).
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
// ── Mirrors src/hooks/useProjectedIncome.ts resolveOccurrenceDetail and
// src/lib/plannerOccurrenceLedger.ts (splitStreamTax, buildOccurrenceLedgerFields).
// Edge runtime cannot import app code; keep these in sync.
const num = (v: unknown) => Number(v || 0);
export function splitStreamTax(s: Row) {
  const agg = num(s.taxes_withheld);
  const payroll = num(s.federal_withholding) + num(s.ss_withholding) + num(s.medicare_withholding);
  const state = num(s.state_withholding);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (payroll + state > 0 && (near(agg, payroll) || near(agg, payroll + state))) {
    return { taxesWithheld: Math.round(payroll * 100) / 100, stateSeparate: true };
  }
  return { taxesWithheld: agg, stateSeparate: false };
}
/**
 * Edited occurrence Tax: when withholding components are classified, Tax is
 * federal + SS + Medicare (state deducted once separately) — even if a legacy
 * saved total included state. Aggregate-only totals stay untouched.
 */
export function splitOverrideTax(ov: Row) {
  const payroll = num(ov.federal_withholding) + num(ov.ss_withholding) + num(ov.medicare_withholding);
  if (payroll + num(ov.state_withholding) > 0) {
    return { taxesWithheld: Math.round(payroll * 100) / 100, stateSeparate: true };
  }
  return { taxesWithheld: num(ov.taxes_withheld), stateSeparate: false };
}
export function resolveOccurrence(s: Row, ov: Row | undefined, date: string) {
  const modified = ov?.action === "modify";
  const detailed = modified && !!ov!.has_detailed_breakdown;
  const snapshot = modified && (detailed || [
    ov!.federal_withholding, ov!.state_withholding, ov!.ss_withholding, ov!.medicare_withholding,
    ov!.healthcare_deduction, ov!.hsa_contribution, ov!.additional_tax_reserve,
  ].some((v) => num(v) > 0));
  const pick = (o: unknown, sv: unknown) => num(snapshot ? o : sv);
  const wpick = (o: unknown, sv: unknown) => num(modified ? o : sv);
  const tax = modified ? splitOverrideTax(ov!) : splitStreamTax(s);
  return {
    date: modified && ov!.new_date ? ov!.new_date : date,
    amount: modified ? num(ov!.paycheck_amount) : num(s.paycheck_amount),
    taxesWithheld: tax.taxesWithheld,
    stateSeparate: tax.stateSeparate,
    retirement401k: modified ? num(ov!.retirement_401k) : num(s.retirement_401k),
    employerRetirement: modified ? num(ov!.employer_retirement_contribution) : num(s.employer_retirement_contribution),
    preTaxDeductions: modified ? num(ov!.pre_tax_deductions) : num(s.pre_tax_deductions),
    healthcareDeduction: pick(ov?.healthcare_deduction, s.healthcare_deduction),
    hsaContribution: pick(ov?.hsa_contribution, s.hsa_contribution),
    // Withholding classifications come only from the edited occurrence (never inherited).
    federalWithholding: wpick(ov?.federal_withholding, s.federal_withholding),
    stateWithholding: wpick(ov?.state_withholding, s.state_withholding),
    ssWithholding: wpick(ov?.ss_withholding, s.ss_withholding),
    medicareWithholding: wpick(ov?.medicare_withholding, s.medicare_withholding),
    additionalTaxReserve: pick(ov?.additional_tax_reserve, s.additional_tax_reserve),
    hasDetailedBreakdown: detailed,
    isSkipped: ov?.action === "skip",
  };
}
export function ledgerFields(o: Row, employerReduces: boolean) {
  const healthcare = num(o.healthcareDeduction), hsa = num(o.hsaContribution);
  const rem = num(o.preTaxDeductions) - healthcare - hsa;
  const otherPre = o.hasDetailedBreakdown ? (rem > 0 ? Math.round(rem * 100) / 100 : 0) : num(o.preTaxDeductions);
  const gross = num(o.amount), taxes = num(o.taxesWithheld), ret = num(o.retirement401k);
  const deposited = Math.max(0, gross - taxes - (o.stateSeparate ? num(o.stateWithholding) : 0) - otherPre - ret
    - healthcare - hsa - (employerReduces ? num(o.employerRetirement) : 0));
  return {
    gross_amount: gross, paycheck_amount: gross, deposited_amount: deposited,
    federal_withholding: num(o.federalWithholding), state_withholding: num(o.stateWithholding),
    ss_withholding: num(o.ssWithholding), medicare_withholding: num(o.medicareWithholding),
    taxes_withheld: taxes, pre_tax_deductions: otherPre, retirement_401k: ret,
    employer_retirement_contribution: num(o.employerRetirement),
    healthcare_deduction: healthcare, hsa_contribution: hsa,
    additional_tax_reserve: num(o.additionalTaxReserve),
  };
}
