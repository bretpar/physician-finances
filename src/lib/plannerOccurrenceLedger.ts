/**
 * CANONICAL Planner occurrence → ledger field mapping.
 *
 * The occurrence being converted is always the source of truth. Parent stream
 * values are only used when the occurrence has no values of its own (resolved
 * upstream by `resolveOccurrenceDetail` / `generateProjectedPaychecks`).
 *
 * Tax accounting rules are unchanged here:
 *  - federal_withholding  → counts as "Paid" in the quarterly tracker
 *  - ss/medicare          → payroll taxes, never quarterly credits
 *  - additional_tax_reserve → "Saved", not "Paid"
 */

/**
 * A detailed occurrence stores the AGGREGATE pre-tax amount (health + HSA +
 * other). The ledger keeps those in separate columns, so the standalone
 * "other pre-tax" remainder must be derived to avoid double counting.
 */
export function deriveOtherPreTax(
  aggregate: number | null | undefined,
  healthcare?: number | null,
  hsa?: number | null,
): number {
  const remainder = Number(aggregate || 0) - Number(healthcare || 0) - Number(hsa || 0);
  return remainder > 0 ? Math.round(remainder * 100) / 100 : 0;
}

export interface OccurrenceLedgerSource {
  grossAmount: number;
  taxesWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
  healthcareDeduction: number;
  hsaContribution: number;
  federalWithholding?: number;
  stateWithholding?: number;
  ssWithholding?: number;
  medicareWithholding?: number;
  additionalTaxReserve?: number;
  hasDetailedBreakdown?: boolean;
}

export interface OccurrenceLedgerFields {
  gross_amount: number;
  paycheck_amount: number;
  deposited_amount: number;
  federal_withholding: number;
  state_withholding: number;
  ss_withholding: number;
  medicare_withholding: number;
  taxes_withheld: number;
  pre_tax_deductions: number;
  retirement_401k: number;
  healthcare_deduction: number;
  hsa_contribution: number;
  additional_tax_reserve: number;
}

const n = (v: unknown) => Number(v || 0);

/** Build the exact ledger columns for one converted planner occurrence. */
export function buildOccurrenceLedgerFields(src: OccurrenceLedgerSource): OccurrenceLedgerFields {
  const healthcare = n(src.healthcareDeduction);
  const hsa = n(src.hsaContribution);
  const otherPreTax = src.hasDetailedBreakdown
    ? deriveOtherPreTax(src.preTaxDeductions, healthcare, hsa)
    : n(src.preTaxDeductions);
  const gross = n(src.grossAmount);
  const taxes = n(src.taxesWithheld);
  const retirement = n(src.retirement401k);
  const deposited = Math.max(0, gross - taxes - otherPreTax - retirement - healthcare - hsa);
  return {
    gross_amount: gross,
    paycheck_amount: gross,
    deposited_amount: deposited,
    federal_withholding: n(src.federalWithholding),
    state_withholding: n(src.stateWithholding),
    ss_withholding: n(src.ssWithholding),
    medicare_withholding: n(src.medicareWithholding),
    taxes_withheld: taxes,
    pre_tax_deductions: otherPreTax,
    retirement_401k: retirement,
    healthcare_deduction: healthcare,
    hsa_contribution: hsa,
    additional_tax_reserve: n(src.additionalTaxReserve),
  };
}
