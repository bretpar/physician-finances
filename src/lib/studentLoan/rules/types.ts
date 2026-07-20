/**
 * Types for the centralized, versioned Federal Student Aid repayment-plan
 * rules registry. Every field is intentionally explicit so the UI can render
 * a full "How this was calculated" breakdown and QA can spot drift.
 *
 * Never hardcode plan math outside `src/lib/studentLoan/`. Never rely on
 * general AI knowledge — every rule here MUST cite `sourceUrl` and record
 * the `sourceUpdatedAt` date when it was last verified against studentaid.gov
 * or the Federal Register.
 */

export type PlanStatus =
  | "current" // available for new enrollment now
  | "legacy" // still available only to eligible existing borrowers
  | "closed" // formerly available; no longer selectable
  | "historical"; // superseded/renamed; never selectable, kept for docs

export type PovertyRegion = "contiguous_48_dc" | "alaska" | "hawaii";

export type PlanFamily =
  | "standard"
  | "graduated"
  | "extended"
  | "tiered_standard"
  | "idr";

export type SpouseIncomeMode =
  | "combined" // household AGI (both spouses)
  | "filer_only" // only the borrower's AGI
  | "community_split"; // 50/50 (or override) allocation applied

export type EligibilityStatus = "confirmed" | "assumed" | "ineligible";

export interface DiscretionaryIncomeRule {
  /** Multiplier applied to the federal poverty guideline (e.g., 1.5 for PAYE/IBR, 1.0 for ICR). */
  povertyMultiplier: number;
  /** If true, use the same tax year as the AGI; default false = prior year. */
  useCurrentYearPoverty?: boolean;
}

export interface BorrowerEligibilityRule {
  /** Plan closed to any borrower with first disbursement on/after this date. */
  excludesFirstDisbursementOnOrAfter?: string;
  /** Plan requires first disbursement on/before this date. */
  requiresFirstDisbursementOnOrBefore?: string;
  /**
   * 'new_2014' = no outstanding balance on any Direct/FFEL loan as of 2014-07-01.
   * 'old' = had a balance on that date.
   * Only applies to IBR variants.
   */
  requiresBorrowerType?: "new_2014" | "old";
  /** Minimum outstanding loan balance to qualify (Extended requires >$30k). */
  minOutstandingBalance?: number;
  /** True if Parent PLUS loans (or consolidations that repaid one) are ineligible. */
  parentPlusIneligible?: boolean;
}

export interface CapRule {
  kind: "none" | "standard_10" | "twelve_year_income_adjusted";
}

export interface TieredTermStep {
  /** Inclusive lower bound of outstanding balance. */
  minBalance: number;
  termMonths: number;
}

export interface IdrBracket {
  /** Inclusive lower AGI bound for this bracket. */
  minAgi: number;
  /** Percent of AGI (0..100). */
  percent: number;
  /** Optional flat annual payment override (RAP's $120 floor for the lowest bracket). */
  flatAnnual?: number;
}

export interface PlanRule {
  id: string;
  displayName: string;
  status: PlanStatus;
  family: PlanFamily;
  /** ISO date the rule became effective (or approximate anniversary). */
  effectiveStart?: string;
  /** ISO date the rule stopped being effective. */
  effectiveEnd?: string;

  eligibleLoanTypes: string[];
  borrowerEligibility: BorrowerEligibilityRule;

  discretionary?: DiscretionaryIncomeRule;
  spouseIncome?: { mfj: SpouseIncomeMode; mfs: SpouseIncomeMode };

  /** Fixed-term amortization in months (Standard/Extended/PAYE-cap). */
  termMonths?: number;
  /** Balance-tiered term (Tiered Standard Plan). */
  tieredTerm?: TieredTermStep[];

  /** Flat % of discretionary income for classic IDR plans (10, 15, 20). */
  idrPercent?: number;
  /** RAP-style tiered percentage of AGI. */
  agiBrackets?: IdrBracket[];
  /** RAP dependent deduction in dollars per dependent per year (converted to monthly). */
  dependentDeductionAnnual?: number;

  cap: CapRule;
  /** Absolute floor for a computed IDR payment (RAP = $10). */
  minPayment: number;
  /** Rounding rule for the reported monthly payment. */
  rounding: "nearest_dollar" | "nearest_cent";

  forgivenessMonths?: number;
  pslfEligible?: boolean;
  interestSubsidy?: string;

  /** Concise UI tooltip. */
  tooltip: string;
  /** Multi-line explanation for the CalculationBreakdown component. */
  description: string;
  /** Human-readable reason shown when the plan is not selectable. */
  unavailableReason?: string;

  sourceUrl: string;
  /** ISO date the rule was last verified against the source. */
  sourceUpdatedAt: string;
  rulesVersion: string;

  /** 'pending' means the rule ships but its numbers still need independent verification. */
  verification: "confirmed" | "pending";
  verificationNotes?: string[];
}

export interface PovertyGuidelineTable {
  year: number;
  region: PovertyRegion;
  base: number; // family of 1
  perAdditionalPerson: number;
  sourceUrl: string;
  publishedAt: string;
  verification: "confirmed" | "pending";
}
