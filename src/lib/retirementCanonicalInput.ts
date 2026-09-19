/**
 * Canonical retirement normalization boundary.
 *
 * Every production consumer of retirement room / deductions goes through here:
 * raw sources (paycheck-derived retirement on income entries, standalone
 * `retirement_contributions` rows, company catalog) are normalized ONCE into a
 * single `RetirementOpportunityInput`, which `computeRetirementOpportunity`
 * then owns. No caller may re-sum these sources independently.
 *
 * Responsibilities:
 *  1. Deduplicate: the same contribution must never enter twice (payroll +
 *     standalone). Reliable identity = the row id it came from; equivalent but
 *     unlinked records are FLAGGED ambiguous and preserved separately rather
 *     than silently merged.
 *  2. Discover plan candidates from eligible companies, not only from rows that
 *     already have contributions, so zero-contribution opportunities show up.
 *  3. Map company filing types to engine entity/plan kinds.
 */

import { normalizeFilingType, type FilingType } from "@/lib/filingTypes";
import {
  type PlanOpportunityInput,
  type RetirementEntityKind,
  type RetirementOpportunityInput,
  type RetirementPlanKind,
  type RetirementFilingStatus,
} from "@/lib/retirementOpportunityEngine";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/* ─────────────────────────── Normalized sources ─────────────────────────── */

export interface CanonicalCompany {
  id: string;
  name: string;
  /** Raw company/filing type (e.g. w2, 1099_schedule_c, k1_partnership). */
  companyType?: string | null;
  payFrequency?: string | null;
}

/** Retirement money recorded on a paycheck / income entry. */
export interface PaycheckRetirementSource {
  /** income_entries.id — the reliable identity for dedup. */
  incomeEntryId: string;
  companyId: string | null;
  employee: number;
  employer: number;
  /** Gross W-2 wages on the entry (employer plan compensation). */
  wages: number;
  date?: string | null;
}

/** An annualized standalone `retirement_contributions` row. */
export interface StandaloneRetirementSource {
  /** retirement_contributions.id — the reliable identity for dedup. */
  id: string;
  companyId: string | null;
  accountType: string;
  contributionType: string;
  /** Already annualized for the tax year by the canonical annualizer. */
  annualAmount: number;
  contributionDate?: string | null;
  /**
   * Explicit linkage to a paycheck, when the data model provides it. When set
   * and matching a paycheck source, the standalone row is dropped as a
   * duplicate instead of being flagged ambiguous.
   */
  linkedIncomeEntryId?: string | null;
}

export interface AmbiguousRetirementPair {
  standaloneId: string;
  incomeEntryId: string;
  companyId: string | null;
  amount: number;
  bucket: "employee" | "employer";
}

export interface DedupedRetirementSources {
  paychecks: PaycheckRetirementSource[];
  standalone: StandaloneRetirementSource[];
  /** Dropped as provably the same contribution (explicit linkage). */
  droppedDuplicateIds: string[];
  /** Possibly the same money, preserved separately and flagged for review. */
  ambiguous: AmbiguousRetirementPair[];
}

/**
 * Dedup boundary. Only explicit linkage removes a record; look-alike amounts
 * are reported through `ambiguous` so unrelated money is never merged away.
 */
export function dedupeRetirementSources(input: {
  paychecks: PaycheckRetirementSource[];
  standalone: StandaloneRetirementSource[];
}): DedupedRetirementSources {
  const paychecks = input.paychecks.filter(
    (p) => num(p.employee) > 0 || num(p.employer) > 0 || num(p.wages) > 0,
  );
  const byEntryId = new Map(paychecks.map((p) => [p.incomeEntryId, p]));

  const droppedDuplicateIds: string[] = [];
  const ambiguous: AmbiguousRetirementPair[] = [];
  const seenStandalone = new Set<string>();
  const standalone: StandaloneRetirementSource[] = [];

  for (const row of input.standalone) {
    if (seenStandalone.has(row.id)) continue; // identical row supplied twice
    seenStandalone.add(row.id);

    if (row.linkedIncomeEntryId && byEntryId.has(row.linkedIncomeEntryId)) {
      // Provably the same contribution — payroll is the canonical carrier.
      droppedDuplicateIds.push(row.id);
      continue;
    }

    const amount = num(row.annualAmount);
    const bucket: "employee" | "employer" =
      (row.contributionType || "employee") === "employer" ? "employer" : "employee";
    if (amount > 0 && row.companyId) {
      const twin = paychecks.find(
        (p) =>
          p.companyId === row.companyId &&
          Math.abs(num(bucket === "employer" ? p.employer : p.employee) - amount) < 0.005 &&
          (!row.contributionDate || !p.date || row.contributionDate === p.date),
      );
      if (twin) {
        ambiguous.push({
          standaloneId: row.id,
          incomeEntryId: twin.incomeEntryId,
          companyId: row.companyId,
          amount,
          bucket,
        });
      }
    }
    standalone.push(row);
  }

  return { paychecks, standalone, droppedDuplicateIds, ambiguous };
}

/* ──────────────────────── Company / plan kind mapping ───────────────────── */

export function entityKindForCompanyType(raw: string | null | undefined): RetirementEntityKind {
  const ft: FilingType = normalizeFilingType(raw);
  switch (ft) {
    case "w2":
      return "w2";
    case "scorp_w2":
    case "scorp_distribution":
      return "s_corp";
    case "1099_schedule_c":
      return "schedule_c";
    case "k1_partnership":
      return "partnership_k1";
    default:
      return "unknown";
  }
}

const ACCOUNT_TO_PLAN_KIND: Record<string, RetirementPlanKind> = {
  "401k": "401k",
  solo_401k: "solo_401k",
  "403b": "403b",
  tsp: "tsp",
  "457b": "governmental_457b",
  governmental_457b: "governmental_457b",
  simple_ira: "simple_ira",
  simple_401k: "simple_401k",
  sep_ira: "sep_ira",
};

export function planKindForAccountType(accountType: string | null | undefined): RetirementPlanKind | null {
  if (!accountType) return null;
  return ACCOUNT_TO_PLAN_KIND[accountType] ?? null;
}

/** Default plan kind for a company that has no explicit plan rows yet. */
export function defaultPlanKindForEntity(entity: RetirementEntityKind): RetirementPlanKind {
  return entity === "schedule_c" || entity === "partnership_k1" ? "solo_401k" : "401k";
}

/* ─────────────────────────── Engine input builder ───────────────────────── */

export interface BuildRetirementInputArgs {
  taxYear: number;
  dateOfBirth?: string | Date | null;
  filingStatus?: RetirementFilingStatus | null;
  /** Canonical AGI/MAGI. `null` => IRA phaseouts are unknown, never assumed. */
  magi?: number | null;
  coveredByWorkplacePlan?: boolean | null;
  spouseCoveredByWorkplacePlan?: boolean | null;
  /** MFS only: lived with spouse at any time in the year. */
  livedWithSpouseDuringYear?: boolean | null;
  /** Eligible taxable compensation for IRA purposes. `null` => unknown. */
  eligibleTaxableCompensation?: number | null;
  companies: CanonicalCompany[];
  sources: DedupedRetirementSources;
  /** Canonical projected year-end net profit by company id (self-employed). */
  projectedNetProfitByCompany?: Map<string, number>;
  /** Actual YTD net profit by company id (self-employed). */
  actualNetProfitByCompany?: Map<string, number>;
  /** Deductible half of SE tax by company id (actual profit), when known. */
  deductibleHalfSeTaxByCompany?: Map<string, number>;
  /** Deductible half of SE tax on PROJECTED year-end profit by company id. */
  projectedDeductibleHalfSeTaxByCompany?: Map<string, number>;
  ira: { traditionalContributed: number; rothContributed: number };
}

export interface BuiltRetirementInput {
  input: RetirementOpportunityInput;
  /** Companies surfaced with zero contributions so far. */
  zeroContributionCompanyIds: string[];
}

/**
 * Build the single engine input. Plan candidates come from the company catalog
 * (so a $0 plan still yields an opportunity or an explicit `unknown_plan_data`)
 * merged with contribution rows keyed by company.
 */
export function buildRetirementOpportunityInput(
  args: BuildRetirementInputArgs,
  opts?: { projected?: boolean },
): BuiltRetirementInput {
  const projected = opts?.projected === true;

  interface Agg {
    employee: number;
    employer: number;
    wages: number;
    planKinds: Set<RetirementPlanKind>;
    hasRows: boolean;
  }
  const agg = new Map<string, Agg>();
  const ensure = (companyId: string) => {
    let a = agg.get(companyId);
    if (!a) {
      a = { employee: 0, employer: 0, wages: 0, planKinds: new Set(), hasRows: false };
      agg.set(companyId, a);
    }
    return a;
  };

  const UNASSIGNED = "__unassigned__";

  for (const p of args.sources.paychecks) {
    const a = ensure(p.companyId || UNASSIGNED);
    a.employee += num(p.employee);
    a.employer += num(p.employer);
    a.wages += num(p.wages);
    if (num(p.employee) > 0 || num(p.employer) > 0) a.hasRows = true;
  }

  for (const row of args.sources.standalone) {
    const planKind = planKindForAccountType(row.accountType);
    if (!planKind) continue; // IRAs / HSA are not employer plans
    const a = ensure(row.companyId || UNASSIGNED);
    a.planKinds.add(planKind);
    const amount = num(row.annualAmount);
    if ((row.contributionType || "employee") === "employer") a.employer += amount;
    else a.employee += amount;
    if (amount > 0) a.hasRows = true;
  }

  // Zero-contribution discovery: every known company is a plan candidate.
  for (const c of args.companies) ensure(c.id);

  const zeroContributionCompanyIds: string[] = [];
  const plans: PlanOpportunityInput[] = [];

  for (const [companyId, a] of agg.entries()) {
    const company = args.companies.find((c) => c.id === companyId);
    const entityKind = company ? entityKindForCompanyType(company.companyType) : "unknown";
    const kinds = a.planKinds.size > 0
      ? Array.from(a.planKinds)
      : [defaultPlanKindForEntity(entityKind)];

    if (!a.hasRows && companyId !== UNASSIGNED) zeroContributionCompanyIds.push(companyId);

    const isSelfEmployed = entityKind === "schedule_c" || entityKind === "partnership_k1";
    const actualProfit = args.actualNetProfitByCompany?.get(companyId);
    const projectedProfit = args.projectedNetProfitByCompany?.get(companyId);
    const profit = projected ? (projectedProfit ?? actualProfit ?? null) : (actualProfit ?? null);

    // Multiple plan kinds at one company each get their own §415(c) evaluation;
    // employee/employer dollars are attributed to the first (primary) kind so
    // the same money is never counted twice across plan rows.
    kinds.forEach((planKind, idx) => {
      const primary = idx === 0;
      plans.push({
        planId: `${companyId}:${planKind}`,
        companyId: companyId === UNASSIGNED ? null : companyId,
        companyName: company?.name || (companyId === UNASSIGNED ? "Unassigned" : "Plan"),
        planKind,
        entityKind,
        employeeContribution: primary ? a.employee : 0,
        employerContribution: primary ? a.employer : 0,
        w2Wages: entityKind === "w2" || entityKind === "s_corp" ? (a.wages > 0 ? a.wages : null) : null,
        netBusinessProfit: entityKind === "schedule_c" ? profit : null,
        k1EarnedIncomeFromServices: entityKind === "partnership_k1" ? profit : null,
        deductibleHalfSeTax: isSelfEmployed
          ? ((projected
              ? args.projectedDeductibleHalfSeTaxByCompany?.get(companyId)
              : undefined) ??
            args.deductibleHalfSeTaxByCompany?.get(companyId) ??
            0)
          : null,
        employerContributionRate: isSelfEmployed ? 0.25 : null,
        employerFormulaKnown: false,
      });
    });
  }

  const input: RetirementOpportunityInput = {
    taxYear: args.taxYear,
    dateOfBirth: args.dateOfBirth ?? null,
    filingStatus: args.filingStatus ?? null,
    magi: args.magi ?? null,
    coveredByWorkplacePlan: args.coveredByWorkplacePlan ?? null,
    spouseCoveredByWorkplacePlan: args.spouseCoveredByWorkplacePlan ?? null,
    livedWithSpouseDuringYear: args.livedWithSpouseDuringYear ?? null,
    eligibleTaxableCompensation: args.eligibleTaxableCompensation ?? null,
    plans,
    ira: {
      traditionalContributed: args.ira.traditionalContributed,
      rothContributed: args.ira.rothContributed,
    },
  };

  return { input, zeroContributionCompanyIds };
}
