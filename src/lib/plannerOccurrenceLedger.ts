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
  /** Employer retirement — stored separately; never reduces Net Received here. */
  employerRetirementContribution?: number;
  /** Company setting: employer retirement reduces cash received (estimate only). */
  employerRetirementReducesPaycheck?: boolean;
  preTaxDeductions: number;
  healthcareDeduction: number;
  hsaContribution: number;
  federalWithholding?: number;
  stateWithholding?: number;
  ssWithholding?: number;
  medicareWithholding?: number;
  additionalTaxReserve?: number;
  hasDetailedBreakdown?: boolean;
  /**
   * True for single-paycheck override snapshots, whose `taxesWithheld` is the
   * federal payroll aggregate (federal + SS + Medicare) with state separate.
   * State is then deducted from cash exactly once. Stream rows keep their
   * legacy aggregate and leave this unset.
   */
  stateSeparate?: boolean;
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
  employer_retirement_contribution: number;
  healthcare_deduction: number;
  hsa_contribution: number;
  additional_tax_reserve: number;
}

const n = (v: unknown) => Number(v || 0);

/**
 * CANONICAL Tax for an UNEDITED (stream-derived) occurrence:
 * Tax = federal income tax + Social Security + Medicare; state stays separate
 * and is deducted from cash once. Applied only when the stream's saved total
 * is recognisably built from its components (either the current
 * federal-payroll total or the legacy total that also included state), so
 * cash withholding is never double-counted or omitted. Aggregate-only streams
 * keep their total untouched and unclassified.
 */
export function splitStreamTax(stream: {
  taxes_withheld?: number | null;
  federal_withholding?: number | null;
  state_withholding?: number | null;
  ss_withholding?: number | null;
  medicare_withholding?: number | null;
}): { taxesWithheld: number; stateSeparate: boolean } {
  const agg = n(stream.taxes_withheld);
  const payroll = n(stream.federal_withholding) + n(stream.ss_withholding) + n(stream.medicare_withholding);
  const state = n(stream.state_withholding);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (payroll + state > 0 && (near(agg, payroll) || near(agg, payroll + state))) {
    return { taxesWithheld: Math.round(payroll * 100) / 100, stateSeparate: true };
  }
  return { taxesWithheld: agg, stateSeparate: false };
}

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
  const employerCash = src.employerRetirementReducesPaycheck ? n(src.employerRetirementContribution) : 0;
  const stateCash = src.stateSeparate ? n(src.stateWithholding) : 0;
  const deposited = Math.max(0, gross - taxes - stateCash - otherPreTax - retirement - healthcare - hsa - employerCash);
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
    employer_retirement_contribution: n(src.employerRetirementContribution),
    healthcare_deduction: healthcare,
    hsa_contribution: hsa,
    additional_tax_reserve: n(src.additionalTaxReserve),
  };
}

/**
 * CANONICAL: when a planner occurrence already points at a real imported bank
 * transaction (confirmed match or high-confidence suggestion in the business
 * bucket), conversion must ENRICH that transaction instead of inserting a new
 * `account_source = "Planner"` row. Returns the transaction id to reuse, or
 * null when a fresh planner-generated row must be created.
 */
export function pickExistingBankTransactionId(
  occurrence: {
    matchStatus?: string;
    matchedIncomeId?: string | null;
    suggestedTransactionId?: string | null;
    suggestedBucket?: "personal" | "business" | null;
  },
  ledgerBucket: "personal" | "business",
): string | null {
  if (ledgerBucket !== "business") return null;
  if (occurrence.matchStatus === "matched" && occurrence.matchedIncomeId) {
    return occurrence.matchedIncomeId;
  }
  if (occurrence.matchStatus === "suggested" && occurrence.suggestedBucket === "business") {
    return occurrence.suggestedTransactionId || null;
  }
  return null;
}
