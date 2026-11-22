/**
 * Flexible Spending Account (FSA) payroll deductions for W-2 employers.
 *
 * Config: per company in `companies.advanced_field_visibility.fsa_deductions`.
 * Paycheck amounts: `income_entries.fsa_health / fsa_dependent_care /
 * fsa_limited_purpose`. These columns are a labeled BREAKDOWN of the
 * paycheck's `pre_tax_deductions` total. Federal wages use that total;
 * FICA uses only classified Section 125 amounts, including this breakdown,
 * so unrestricted Other Pre-Tax is not assumed FICA-exempt
 * and FSA money is never an extra above-the-line deduction.
 *
 * Limits (IRS Rev. Proc. 2023-34, 2024-40, 2025-32; IRC §129 as amended by
 * P.L. 119-21 for 2026+ dependent care).
 */
export const FSA_DEDUCTIONS_KEY = "fsa_deductions";

export type FsaKind = "health" | "dependent_care" | "limited_purpose";
export const FSA_KINDS: FsaKind[] = ["health", "dependent_care", "limited_purpose"];
export const FSA_LABELS: Record<FsaKind, string> = {
  health: "Healthcare FSA",
  dependent_care: "Dependent Care FSA",
  limited_purpose: "Limited Purpose FSA",
};
export const FSA_COLUMN: Record<FsaKind, "fsa_health" | "fsa_dependent_care" | "fsa_limited_purpose"> = {
  health: "fsa_health",
  dependent_care: "fsa_dependent_care",
  limited_purpose: "fsa_limited_purpose",
};

export interface FsaLimits {
  taxYear: number;
  /** Health FSA salary-reduction limit (shared by general + limited-purpose in one employer's plan). */
  health: number;
  dependentCare: number;
  dependentCareMfs: number;
}

export const FSA_LIMITS_BY_YEAR: Record<number, FsaLimits> = {
  2024: { taxYear: 2024, health: 3200, dependentCare: 5000, dependentCareMfs: 2500 },
  2025: { taxYear: 2025, health: 3300, dependentCare: 5000, dependentCareMfs: 2500 },
  2026: { taxYear: 2026, health: 3400, dependentCare: 7500, dependentCareMfs: 3750 },
  2027: { taxYear: 2027, health: 3500, dependentCare: 7500, dependentCareMfs: 3750 },
};

export function getFsaLimits(year: number): FsaLimits & { inferred: boolean } {
  const known = FSA_LIMITS_BY_YEAR[year];
  if (known) return { ...known, inferred: false };
  const latest = Math.max(...Object.keys(FSA_LIMITS_BY_YEAR).map(Number));
  return { ...FSA_LIMITS_BY_YEAR[latest], taxYear: year, inferred: true };
}

export interface FsaDeductionConfig {
  enabled: boolean;
  perPaycheck: number;
  /** YYYY-MM-DD, inclusive. */
  startDate: string | null;
  /** YYYY-MM-DD, inclusive. */
  endDate: string | null;
  annualElection: number | null;
}
export type FsaConfigs = Partial<Record<FsaKind, FsaDeductionConfig>>;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function readFsaConfigs(meta: unknown): FsaConfigs {
  if (!meta || typeof meta !== "object") return {};
  const raw = (meta as Record<string, unknown>)[FSA_DEDUCTIONS_KEY];
  if (!raw || typeof raw !== "object") return {};
  const out: FsaConfigs = {};
  for (const k of FSA_KINDS) {
    const r = (raw as Record<string, unknown>)[k] as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object") continue;
    out[k] = { enabled: r.enabled === true, perPaycheck: num(r.perPaycheck) ?? 0, startDate: date(r.startDate), endDate: date(r.endDate), annualElection: num(r.annualElection) };
  }
  return out;
}

export function writeFsaConfigs<T extends object>(meta: T | null | undefined, configs: FsaConfigs): T {
  const next = { ...(meta ?? {}) } as Record<string, unknown>;
  next[FSA_DEDUCTIONS_KEY] = { ...configs };
  return next as T;
}

/** Recurring default amounts for a paycheck dated `paycheckDate` (outside the range → 0). */
export function fsaDefaultsForDate(configs: FsaConfigs, paycheckDate: string): Record<FsaKind, number> {
  const out = { health: 0, dependent_care: 0, limited_purpose: 0 } as Record<FsaKind, number>;
  for (const k of FSA_KINDS) {
    const c = configs[k];
    if (!c?.enabled || c.perPaycheck <= 0) continue;
    if (c.startDate && paycheckDate < c.startDate) continue;
    if (c.endDate && paycheckDate > c.endDate) continue;
    out[k] = c.perPaycheck;
  }
  return out;
}

export interface FsaPaycheckRow {
  income_date: string;
  source_id?: string | null;
  fsa_health?: number | null;
  fsa_dependent_care?: number | null;
  fsa_limited_purpose?: number | null;
}

export interface FsaKindSummary {
  kind: FsaKind;
  contributed: number;
  /** Annual election total across employers when entered, otherwise null. */
  election: number | null;
  limit: number;
  /** Remaining under the lower of election and IRS limit. */
  remaining: number;
}

export interface FsaSummary {
  year: number;
  limitsInferred: boolean;
  kinds: FsaKindSummary[];
  warnings: string[];
}

/**
 * Household summary for the tax year. Health + limited-purpose share one
 * health FSA limit per employer; dependent care is a household limit.
 * Warnings only — never edits or caps saved contributions.
 */
export function summarizeFsa(args: {
  year: number;
  rows: FsaPaycheckRow[];
  configsByCompany: Record<string, FsaConfigs>;
  filingStatus: string | null | undefined;
  hsaEnabled?: boolean;
}): FsaSummary {
  const limits = getFsaLimits(args.year);
  const prefix = `${args.year}-`;
  const rows = args.rows.filter((r) => (r.income_date || "").startsWith(prefix));
  const sum = (col: keyof FsaPaycheckRow, cid?: string) => rows.filter((r) => cid == null || r.source_id === cid).reduce((s, r) => s + (Number(r[col]) || 0), 0);
  const elections = (k: FsaKind) => {
    const vals = Object.values(args.configsByCompany).flatMap((c) => c[k]?.enabled && c[k]?.annualElection != null ? [Number(c[k]?.annualElection)] : []);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const companiesWith = (k: FsaKind) => Object.entries(args.configsByCompany).filter(([, c]) => c[k]?.enabled).map(([id]) => id);
  const healthEmployers = new Set([...companiesWith("health"), ...companiesWith("limited_purpose")]);
  for (const row of rows) if (row.source_id && (Number(row.fsa_health) > 0 || Number(row.fsa_limited_purpose) > 0)) healthEmployers.add(row.source_id);
  const dcLimit = args.filingStatus === "married_filing_separately" ? limits.dependentCareMfs : limits.dependentCare;
  const kinds: FsaKindSummary[] = FSA_KINDS.map((kind) => {
    const contributed = sum(FSA_COLUMN[kind]);
    const election = elections(kind);
    const limit = kind === "dependent_care" ? dcLimit : limits.health * Math.max(1, healthEmployers.size);
    const cap = election != null ? Math.min(election, limit) : limit;
    const remaining = kind === "dependent_care" ? Math.max(0, cap - contributed) :
      Array.from(healthEmployers).reduce((total, cid) => {
        const sharedRoom = Math.max(0, limits.health - sum("fsa_health", cid) - sum("fsa_limited_purpose", cid));
        const ownElection = args.configsByCompany[cid]?.[kind]?.annualElection;
        return total + Math.min(sharedRoom, ownElection != null ? Math.max(0, ownElection - sum(FSA_COLUMN[kind], cid)) : sharedRoom);
      }, healthEmployers.size === 0 ? Math.max(0, limits.health - sum("fsa_health") - sum("fsa_limited_purpose")) : 0);
    return { kind, contributed, election, limit, remaining };
  });
  const warnings: string[] = [];
  for (const cid of healthEmployers) {
    const total = sum("fsa_health", cid) + sum("fsa_limited_purpose", cid);
    const elect = (args.configsByCompany[cid]?.health?.annualElection ?? 0) + (args.configsByCompany[cid]?.limited_purpose?.annualElection ?? 0);
    if (total > limits.health || elect > limits.health) {
      warnings.push(`Healthcare and Limited Purpose FSA at one employer share a ${fmt(limits.health)} limit; this employer is over it.`);
      break;
    }
  }
  const dc = kinds.find((k) => k.kind === "dependent_care");
  if (dc && (dc.contributed > dcLimit || (dc.election ?? 0) > dcLimit)) warnings.push(`Dependent Care FSA is over the ${fmt(dcLimit)} household limit${args.filingStatus === "married_filing_separately" ? " for married filing separately" : ""}. Include any spouse's dependent care benefits too.`);
  if (args.hsaEnabled && companiesWith("health").length > 0) warnings.push("A general-purpose Healthcare FSA usually makes you ineligible to contribute to an HSA. A Limited Purpose FSA can be used with an HSA.");
  return { year: args.year, limitsInferred: limits.inferred, kinds, warnings };
}

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Total of the three FSA amounts on a paycheck. */
export function fsaTotal(v: Partial<Record<FsaKind, number>>): number {
  return FSA_KINDS.reduce((s, k) => s + Math.max(0, Number(v[k]) || 0), 0);
}

/** Only untouched fields of a new paycheck follow employer/date changes. */
export function refreshFsaDefaults<T extends Record<(typeof FSA_COLUMN)[FsaKind], string>>(
  form: T, configs: FsaConfigs, paycheckDate: string, dirty: Partial<Record<FsaKind, boolean>>, historical: boolean,
): T {
  if (historical) return form;
  const defaults = fsaDefaultsForDate(configs, paycheckDate);
  return { ...form, ...Object.fromEntries(FSA_KINDS.filter((k) => !dirty[k]).map((k) => [FSA_COLUMN[k], defaults[k] ? String(defaults[k]) : ""])) };
}

// Explicit FSA classifications in existing Planner notes; never guess from dollars.
const PLANNER_FSA = /\n?\[paycheckmd-fsa:(\{[^\n]*\})\]/g;
export function readPlannerFsa(notes?: string | null): Partial<Record<FsaKind, number>> {
  const match = /\[paycheckmd-fsa:(\{[^\n]*\})\]/.exec(notes ?? "");
  if (!match) return {};
  try {
    const raw = JSON.parse(match[1]);
    return Object.fromEntries(FSA_KINDS.filter((k) => raw[k] != null && Number.isFinite(Number(raw[k])) && Number(raw[k]) >= 0).map((k) => [k, Number(raw[k])]));
  } catch { return {}; }
}
export function plannerFsaNotes(notes: string, included: Partial<Record<FsaKind, number>>): string {
  const text = notes.replace(PLANNER_FSA, "");
  return Object.keys(included).length ? `${text}\n[paycheckmd-fsa:${JSON.stringify(included)}]` : text;
}
/** Included values (including explicit zero) override Settings; unrelated deductions stay intact. */
export function projectFsa(preTax: number, configs: FsaConfigs, date: string, included: Partial<Record<FsaKind, number>> = {}) {
  const defaults = fsaDefaultsForDate(configs, date);
  const breakdown = Object.fromEntries(FSA_KINDS.map((k) => [k, included[k] ?? defaults[k]])) as Record<FsaKind, number>;
  const added = fsaTotal(Object.fromEntries(FSA_KINDS.filter((k) => included[k] == null).map((k) => [k, defaults[k]])));
  return { preTaxDeductions: Math.max(0, preTax) + added, fsaDeductions: breakdown, fsaAddedAmount: added };
}
