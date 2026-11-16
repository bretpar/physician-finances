/**
 * Presentation grouping for the Retirement Tax Savings planner.
 *
 * Pure and read-only: it never computes limits or capacity (those come from
 * the canonical engine via `computeRetirementRoomView`). It only sorts the
 * ORIGINAL contribution records into the four planner categories, grouped by
 * company id, and keeps recorded (actual) rows apart from scheduled ones.
 * Recurring templates stay one row each — individual deposits are never
 * invented from them.
 */
import { normalizeFilingType } from "@/lib/filingType";

export type PlannerCategory = "employee" | "w2_employer" | "self_employed_employer" | "ira";

export interface PlannerHistoryRow {
  /** Stable key: source record id + money side. */
  key: string;
  recordId: string;
  category: PlannerCategory;
  companyId: string | null;
  date: string | null;
  funding: "Employee" | "Employer" | "Personal";
  source: "Paycheck" | "Manual" | "Planner";
  /** Repeating manual entries are shown as one summarized row. */
  recurringLabel?: string;
  amount: number;
  scheduled: boolean;
  accountLabel?: string;
  /** Set when this record may duplicate another one. */
  possibleDuplicate: boolean;
  /** Manual record that can be edited/deleted. */
  editableId?: string;
}

export interface PlannerPaycheckRecord {
  id: string;
  companyId: string | null;
  date: string | null;
  employee: number;
  employer: number;
}

export interface PlannerScheduledPaycheck {
  key: string;
  companyId: string;
  date: string;
  employee: number;
  employer: number;
}

export interface PlannerStandaloneRecord {
  id: string;
  companyId: string | null;
  accountType: string;
  accountLabel: string;
  contributionType: string | null;
  frequency: string;
  date: string | null;
  perContribution: number;
  /** Amount through today (already computed by the canonical annualizer). */
  actual: number;
  /** Rest-of-year amount from the canonical annualizer. */
  scheduled: number;
}

export interface PlannerCompanyRef {
  id: string;
  companyType?: string | null;
}

const IRA_TYPES = new Set(["traditional_ira", "roth_ira"]);

export function isSelfEmployedCompanyType(companyType?: string | null): boolean {
  const ft = normalizeFilingType(companyType);
  return ft === "1099_schedule_c" || ft === "k1_partnership";
}

export function buildPlannerHistory(args: {
  taxYear: number;
  todayISO: string;
  companies: PlannerCompanyRef[];
  paychecks: PlannerPaycheckRecord[];
  scheduledPaychecks: PlannerScheduledPaycheck[];
  standalone: PlannerStandaloneRecord[];
  ambiguousIds?: Iterable<string>;
}): PlannerHistoryRow[] {
  const typeOf = new Map(args.companies.map((c) => [c.id, c.companyType ?? null]));
  const selfEmployed = (cid: string | null) => !!cid && isSelfEmployedCompanyType(typeOf.get(cid));
  const ambiguous = new Set(args.ambiguousIds ?? []);
  const year = String(args.taxYear);
  const rows: PlannerHistoryRow[] = [];
  const employerCategory = (cid: string | null): PlannerCategory =>
    selfEmployed(cid) ? "self_employed_employer" : "w2_employer";

  for (const p of args.paychecks) {
    if (String(p.date || "").slice(0, 4) !== year) continue;
    const scheduled = String(p.date || "") > args.todayISO;
    const dup = ambiguous.has(p.id);
    if (p.employee > 0) rows.push({ key: `${p.id}:employee`, recordId: p.id, category: "employee", companyId: p.companyId, date: p.date, funding: "Employee", source: "Paycheck", amount: p.employee, scheduled, possibleDuplicate: dup });
    if (p.employer > 0) rows.push({ key: `${p.id}:employer`, recordId: p.id, category: employerCategory(p.companyId), companyId: p.companyId, date: p.date, funding: "Employer", source: "Paycheck", amount: p.employer, scheduled, possibleDuplicate: dup });
  }
  for (const p of args.scheduledPaychecks) {
    if (p.employee > 0) rows.push({ key: `${p.key}:employee`, recordId: p.key, category: "employee", companyId: p.companyId, date: p.date, funding: "Employee", source: "Planner", amount: p.employee, scheduled: true, possibleDuplicate: false });
    if (p.employer > 0) rows.push({ key: `${p.key}:employer`, recordId: p.key, category: employerCategory(p.companyId), companyId: p.companyId, date: p.date, funding: "Employer", source: "Planner", amount: p.employer, scheduled: true, possibleDuplicate: false });
  }
  for (const s of args.standalone) {
    const isIra = IRA_TYPES.has(s.accountType);
    const employer = !isIra && (s.accountType === "sep_ira" || s.contributionType === "employer");
    const category: PlannerCategory = isIra ? "ira" : employer ? employerCategory(s.companyId) : "employee";
    const funding = isIra ? "Personal" : employer ? "Employer" : "Employee";
    const companyId = isIra ? null : s.companyId;
    const base = { recordId: s.id, category, companyId, funding, source: "Manual" as const, accountLabel: s.accountLabel, possibleDuplicate: ambiguous.has(s.id), editableId: s.id };
    if (s.frequency === "one_time") {
      const amount = s.actual + s.scheduled;
      if (amount <= 0) continue;
      rows.push({ ...base, key: `${s.id}:one`, date: s.date, amount, scheduled: s.actual <= 0 && s.scheduled > 0 });
      continue;
    }
    const recurringLabel = `${s.frequency.replace(/_/g, " ")} from ${s.date ?? "start"}`;
    if (s.actual > 0) rows.push({ ...base, key: `${s.id}:actual`, date: s.date, amount: s.actual, scheduled: false, recurringLabel });
    if (s.scheduled > 0) rows.push({ ...base, key: `${s.id}:scheduled`, date: null, amount: s.scheduled, scheduled: true, recurringLabel });
  }
  return rows.sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));
}

export function sumRows(rows: PlannerHistoryRow[], scheduled: boolean): number {
  return rows.filter((r) => r.scheduled === scheduled).reduce((s, r) => s + r.amount, 0);
}

/** Group by company id (null = unassigned), preserving first-seen order. */
export function groupRowsByCompany(rows: PlannerHistoryRow[]): Map<string | null, PlannerHistoryRow[]> {
  const map = new Map<string | null, PlannerHistoryRow[]>();
  for (const r of rows) map.set(r.companyId, [...(map.get(r.companyId) ?? []), r]);
  return map;
}
