import type { BusinessRelationship } from "./businessRelationships";
import {
  estimateEmployerContribution,
  type EmployerContributionFormula,
} from "./employerContributionFormula";
import { resolveIncomeEarner } from "@/lib/incomeEarner";
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

import { isK1TreatmentSETaxable, type K1TaxTreatment } from "@/lib/k1TaxTreatment";
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
  /** companies.employee_role — the canonical income earner. */
  employeeRole?: "primary" | "spouse" | null;
  /** K-1 only: saved K-1 tax treatment (active / guaranteed / passive / S-corp). */
  k1TaxTreatment?: string | null;
  /** User-recorded related-business setting (retirement shared limits). */
  retirementRelationship?: BusinessRelationship | null;
  /** User-recorded W-2 employer match/profit-sharing formula. */
  employerFormula?: EmployerContributionFormula | null;
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
  /**
   * True for a FUTURE Planner occurrence (not yet paid). Scheduled money is
   * excluded from actual YTD and only enters the projected year-end run.
   */
  scheduled?: boolean;
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
  /** Recurring rows only: occurrences after the as-of date (projected run only). */
  scheduledAmount?: number;
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
  // Only recorded paychecks can be the "same money" as a standalone row.
  const recorded = paychecks.filter((p) => !p.scheduled);
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
      const twin = recorded.find(
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

/**
 * K-1 profit counts as earned income for services ONLY with a supporting
 * classification: active partner / guaranteed payments → profit; passive or
 * S-corp distribution → $0; unset → `null` (needs verification).
 */
export function k1ServiceEarnings(
  treatment: string | null | undefined,
  profit: number | null,
): number | null {
  if (profit == null) return null;
  const seTaxable = isK1TreatmentSETaxable((treatment ?? null) as K1TaxTreatment | null);
  if (seTaxable == null) return null;
  return seTaxable ? profit : 0;
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
    companyId: string;
    /** Resolved plan kind; null => payroll money with an unresolved plan. */
    planKind: RetirementPlanKind | null;
    employee: number;
    employer: number;
    hasRows: boolean;
    sourceIds: string[];
  }
  const UNASSIGNED = "__unassigned__";
  const agg = new Map<string, Agg>();
  const wagesByCompany = new Map<string, number>();
  const entityFor = (cid: string) => {
    const c = args.companies.find((x) => x.id === cid);
    return c ? entityKindForCompanyType(c.companyType) : "unknown";
  };
  const ensure = (companyId: string, planKind: RetirementPlanKind | null) => {
    const key = `${companyId}:${planKind ?? "payroll_unresolved"}`;
    let a = agg.get(key);
    if (!a) {
      a = { companyId, planKind, employee: 0, employer: 0, hasRows: false, sourceIds: [] };
      agg.set(key, a);
    }
    return a;
  };

  /* Explicit plan kinds per company (from standalone rows). Payroll money has no
     plan type of its own: it is attributed to the company's ONLY explicit plan
     kind when there is exactly one, otherwise to the company's default kind —
     never to whichever kind happened to appear first. */
  const explicitKinds = new Map<string, Set<RetirementPlanKind>>();
  for (const row of args.sources.standalone) {
    const k = planKindForAccountType(row.accountType);
    if (!k) continue;
    const cid = row.companyId || UNASSIGNED;
    if (!explicitKinds.has(cid)) explicitKinds.set(cid, new Set());
    explicitKinds.get(cid)!.add(k);
  }
  /* Resolve BEFORE aggregating: none → company default, one → that plan,
     several → explicitly unresolved (its own plan entry, flagged). */
  const payrollKindFor = (cid: string): RetirementPlanKind | null => {
    const kinds = explicitKinds.get(cid);
    if (!kinds || kinds.size === 0) return defaultPlanKindForEntity(entityFor(cid));
    return kinds.size === 1 ? Array.from(kinds)[0] : null;
  };

  for (const p of args.sources.paychecks) {
    if (p.scheduled && !projected) continue; // future money is never "actual"
    const cid = p.companyId || UNASSIGNED;
    wagesByCompany.set(cid, (wagesByCompany.get(cid) ?? 0) + num(p.wages));
    if (num(p.employee) <= 0 && num(p.employer) <= 0) continue;
    const a = ensure(cid, payrollKindFor(cid));
    a.employee += num(p.employee);
    a.employer += num(p.employer);
    a.hasRows = true;
    a.sourceIds.push(p.incomeEntryId);
  }

  for (const row of args.sources.standalone) {
    const planKind = planKindForAccountType(row.accountType);
    if (!planKind) continue; // IRAs / HSA are not employer plans
    const a = ensure(row.companyId || UNASSIGNED, planKind);
    const amount = num(row.annualAmount) + (projected ? num(row.scheduledAmount) : 0);
    if ((row.contributionType || "employee") === "employer") a.employer += amount;
    else a.employee += amount;
    if (amount > 0) a.hasRows = true;
    a.sourceIds.push(row.id);
  }

  // Zero-contribution discovery: every known company is a plan candidate.
  for (const c of args.companies) {
    const hasAny = Array.from(agg.values()).some((a) => a.companyId === c.id);
    if (!hasAny) ensure(c.id, defaultPlanKindForEntity(entityFor(c.id)));
  }

  const zeroContributionCompanyIds: string[] = [];
  const plans: PlanOpportunityInput[] = [];
  const companiesWithRows = new Set(
    Array.from(agg.values()).filter((a) => a.hasRows).map((a) => a.companyId),
  );

  // Stable, order-independent output.
  const ordered = Array.from(agg.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [aggKey, a] of ordered) {
    const companyId = a.companyId;
    const company = args.companies.find((c) => c.id === companyId);
    const entityKind = company ? entityKindForCompanyType(company.companyType) : "unknown";
    const planKind = a.planKind ?? defaultPlanKindForEntity(entityKind);

    if (!companiesWithRows.has(companyId) && companyId !== UNASSIGNED && !zeroContributionCompanyIds.includes(companyId)) {
      zeroContributionCompanyIds.push(companyId);
    }

    const isSelfEmployed = entityKind === "schedule_c" || entityKind === "partnership_k1";
    const actualProfit = args.actualNetProfitByCompany?.get(companyId);
    const projectedProfit = args.projectedNetProfitByCompany?.get(companyId);
    const profit = projected ? (projectedProfit ?? actualProfit ?? null) : (actualProfit ?? null);
    const wages = wagesByCompany.get(companyId) ?? 0;
    const earner = resolveIncomeEarner(company);

    plans.push({
      planId: aggKey,
      payrollPlanUnresolved: a.planKind == null,
      companyId: companyId === UNASSIGNED ? null : companyId,
      companyName: company?.name || (companyId === UNASSIGNED ? "Unassigned" : "Plan"),
      earner,
      // Plans of the SAME company share one §415(c) / formula capacity.
      employerGroupKey: `${earner}:${companyId}`,
      sourceRecordIds: [...a.sourceIds].sort(),
      planKind,
      entityKind,
      employeeContribution: a.employee,
      employerContribution: a.employer,
      w2Wages: entityKind === "w2" || entityKind === "s_corp" ? (wages > 0 ? wages : null) : null,
      netBusinessProfit: entityKind === "schedule_c" ? profit : null,
      k1EarnedIncomeFromServices:
        entityKind === "partnership_k1" ? k1ServiceEarnings(company?.k1TaxTreatment, profit) : null,
      deductibleHalfSeTax: isSelfEmployed
        ? ((projected
            ? args.projectedDeductibleHalfSeTaxByCompany?.get(companyId)
            : undefined) ??
          args.deductibleHalfSeTaxByCompany?.get(companyId) ??
          0)
        : null,
      employerContributionRate: isSelfEmployed ? 0.25 : null,
      employerFormulaKnown: !isSelfEmployed && company?.employerFormula != null,
      estimatedEmployerContribution:
        !isSelfEmployed && company?.employerFormula
          ? estimateEmployerContribution(company.employerFormula, wages > 0 ? wages : null, a.employee)
          : 0,
      businessRelationship: company?.retirementRelationship?.status ?? null,
      relatedGroupId:
        company?.retirementRelationship?.status === "related" ? company.retirementRelationship.groupId : null,
      sharedAnnualLimit:
        company?.retirementRelationship?.status === "related"
          ? company.retirementRelationship.sharedAnnualLimit
          : null,
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
