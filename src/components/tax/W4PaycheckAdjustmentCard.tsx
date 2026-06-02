import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, AlertCircle, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useCompanies } from "@/contexts/CompanyContext";
import {
  useProjectedStreams,
  useProjectedBonuses,
  useStreamOverrides,
  usePlannerConversions,
  generateProjectedPaychecks,
  type ProjectedIncomeStream,
} from "@/hooks/useProjectedIncome";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { getSavingsRateForIncomeBucket } from "@/lib/savingsRateSelection";
import { normalizeFilingType, isW2FilingType } from "@/lib/filingTypes";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.round(n),
  );

function formatFrequencyLabel(freq: string): string {
  switch (freq) {
    case "weekly":
      return "Weekly paycheck";
    case "biweekly":
      return "Biweekly paycheck";
    case "semimonthly":
      return "Semimonthly paycheck";
    case "monthly":
      return "Monthly paycheck";
    case "quarterly":
      return "Quarterly paycheck";
    case "annually":
      return "Annual paycheck";
    case "single":
      return "One-time paycheck";
    case "custom":
      return "Custom-interval paycheck";
    default:
      return freq ? `${freq.charAt(0).toUpperCase()}${freq.slice(1)} paycheck` : "Paycheck";
  }
}

function isW2Stream(s: ProjectedIncomeStream): boolean {
  const ft = normalizeFilingType(s.company_type);
  return ft === "w2" || ft === "scorp_w2";
}

export function defaultRemainingPaychecks(frequency: string, today: Date = new Date()): number {
  const year = today.getFullYear();
  const yearEnd = new Date(year, 11, 31);
  const msPerDay = 86_400_000;
  const daysLeft = Math.max(0, Math.ceil((yearEnd.getTime() - today.getTime()) / msPerDay));
  switch (frequency) {
    case "weekly":
      return Math.max(0, Math.floor(daysLeft / 7));
    case "biweekly":
      return Math.max(0, Math.floor(daysLeft / 14));
    case "semimonthly": {
      // Count remaining 15th and end-of-month dates
      let count = 0;
      for (let m = today.getMonth(); m <= 11; m++) {
        const mid = new Date(year, m, 15);
        const end = new Date(year, m + 1, 0);
        if (mid > today) count++;
        if (end > today) count++;
      }
      return count;
    }
    case "monthly": {
      // Count remaining month-end paydates
      let count = 0;
      for (let m = today.getMonth(); m <= 11; m++) {
        const end = new Date(year, m + 1, 0);
        if (end > today) count++;
      }
      return count;
    }
    case "quarterly": {
      const quarterEnds = [2, 5, 8, 11].map((m) => new Date(year, m + 1, 0));
      return quarterEnds.filter((d) => d > today).length;
    }
    case "annually":
    case "single":
      return 1;
    default:
      return Math.max(0, Math.floor(daysLeft / 14));
  }
}

function roundToNearest5(n: number): number {
  return Math.round(n / 5) * 5;
}

/**
 * Infer pay frequency from a series of paycheck dates (YYYY-MM-DD).
 * Returns null when there isn't enough signal (<2 dates).
 */
export function detectFrequencyFromDates(
  dates: string[],
): { frequency: string | null; lastDate: string | null } {
  if (!dates || dates.length === 0) return { frequency: null, lastDate: null };
  const sorted = [...dates].filter(Boolean).sort();
  const lastDate = sorted[sorted.length - 1] ?? null;
  if (sorted.length < 2) return { frequency: null, lastDate };
  const msPerDay = 86_400_000;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = new Date(sorted[i - 1] + "T00:00:00").getTime();
    const b = new Date(sorted[i] + "T00:00:00").getTime();
    const d = Math.round((b - a) / msPerDay);
    if (d > 0 && d < 200) gaps.push(d);
  }
  if (gaps.length === 0) return { frequency: null, lastDate };
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
  let frequency: string;
  if (median <= 9) frequency = "weekly";
  else if (median <= 18) frequency = "biweekly";
  else if (median <= 22) frequency = "semimonthly";
  else if (median <= 45) frequency = "monthly";
  else if (median <= 120) frequency = "quarterly";
  else frequency = "annually";
  return { frequency, lastDate };
}

/**
 * Count remaining paydates in the current year, starting from the next
 * occurrence after `lastDate`, given a pay frequency.
 */
export function paychecksFromLastDate(
  frequency: string,
  lastDate: string,
  today: Date = new Date(),
): number {
  const year = today.getFullYear();
  const yearEnd = new Date(year, 11, 31);
  const last = new Date(lastDate + "T00:00:00");
  if (isNaN(last.getTime())) return defaultRemainingPaychecks(frequency, today);
  const msPerDay = 86_400_000;
  const stepDays =
    frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : null;
  if (stepDays) {
    let next = new Date(last.getTime() + stepDays * msPerDay);
    let count = 0;
    while (next <= yearEnd) {
      if (next > today) count++;
      next = new Date(next.getTime() + stepDays * msPerDay);
    }
    return count;
  }
  if (frequency === "semimonthly") {
    let count = 0;
    for (let m = last.getMonth(); m <= 11; m++) {
      const mid = new Date(year, m, 15);
      const end = new Date(year, m + 1, 0);
      if (mid > last && mid > today) count++;
      if (end > last && end > today) count++;
    }
    return count;
  }
  if (frequency === "monthly") {
    let count = 0;
    for (let m = last.getMonth(); m <= 11; m++) {
      const end = new Date(year, m + 1, 0);
      if (end > last && end > today) count++;
    }
    return count;
  }
  if (frequency === "quarterly") {
    const quarterEnds = [2, 5, 8, 11].map((m) => new Date(year, m + 1, 0));
    return quarterEnds.filter((d) => d > last && d > today).length;
  }
  if (frequency === "annually" || frequency === "single") return 0;
  return defaultRemainingPaychecks(frequency, today);
}

export type EmployerRow = {
  /** Stable employer-grouping key (used as React key + override key). */
  streamId: string;
  company: string;
  payFrequency: string;
  remainingPaychecks: number;
  remainingGross: number;
  expectedNormalWithholding: number;
  /** Underlying projected income stream IDs grouped into this employer row. */
  streamIds?: string[];
  /** Streams collapsed/ignored because they duplicated another schedule for the same employer. */
  droppedStreamIds?: string[];
};

/**
 * Normalize an employer/company display name for grouping. Lowercases,
 * strips punctuation, and collapses whitespace so minor visible variants
 * ("Optum", "OPTUM", " Optum, Inc. ") collapse to the same key.
 */
export function normalizeEmployerName(name: string | null | undefined): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** URL/testid-safe slug for an employer name. Falls back to "employer". */
export function employerSlug(name: string | null | undefined): string {
  const slug = normalizeEmployerName(name).replace(/\s+/g, "-");
  return slug || "employer";
}

/**
 * Build a stable W-4 employer-grouping key for a projected stream.
 *
 * Groups by canonical employer identity (normalized company name +
 * W-2/non-W-2 bucket), NOT by source_id — multiple company/source records
 * pointing at the same real employer should still produce one W-4 row.
 * source_id is preserved as metadata on the grouped row.
 */
export function employerKeyForStream(s: {
  source_id?: string | null;
  company?: string | null;
  company_type?: string | null;
}): string {
  const name = normalizeEmployerName(s.company);
  const ft = normalizeFilingType(s.company_type || "") || "";
  // W-2 and scorp_w2 share the same W-4 bucket — both are W-2 employer rows.
  const bucket = ft === "w2" || ft === "scorp_w2" ? "w2" : ft || "other";
  return `emp:${name}|${bucket}`;
}

export type GroupedStreamInput = {
  id: string;
  company: string;
  company_type: string;
  pay_frequency: string;
  source_id: string | null;
  updated_at: string;
  is_active: boolean;
};

export type EmployerGroup = {
  employerKey: string;
  primaryStreamId: string;
  /** All streams belonging to this employer (no streams are dropped). */
  includedStreamIds: string[];
  /** Kept for back-compat — always empty under canonical-name grouping. */
  droppedStreamIds: string[];
  /** Distinct source_id values across all streams in the group. */
  uniqueSourceIds: string[];
  /** Number of duplicate (overlapping) future pay dates across grouped streams. */
  overlapDateCount: number;
  company: string;
  payFrequency: string;
  sourceId: string | null;
};

/**
 * Group W-2 streams by canonical employer key. All streams for the same
 * employer collapse into a single row regardless of source_id. Per-date
 * deduplication is handled later when summing gross/withholding so
 * overlapping schedules never double-count the same paycheck.
 */
export function groupW2StreamsByEmployer(
  w2Streams: GroupedStreamInput[],
  futurePaycheckDatesByStream: Map<string, Set<string>>,
): EmployerGroup[] {
  const byKey = new Map<string, GroupedStreamInput[]>();
  for (const s of w2Streams) {
    const k = employerKeyForStream(s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }

  const groups: EmployerGroup[] = [];
  for (const [key, streams] of byKey) {
    const sorted = [...streams].sort((a, b) =>
      (b.updated_at || "").localeCompare(a.updated_at || ""),
    );
    const primary = sorted[0];
    const includedStreamIds = sorted.map((s) => s.id);

    // Count overlapping future pay dates across all streams in this group.
    const seenDates = new Set<string>();
    let overlapDateCount = 0;
    for (const s of sorted) {
      const dates = futurePaycheckDatesByStream.get(s.id) ?? new Set<string>();
      for (const d of dates) {
        if (seenDates.has(d)) overlapDateCount++;
        else seenDates.add(d);
      }
    }

    const uniqueSourceIds = Array.from(
      new Set(sorted.map((s) => s.source_id).filter((v): v is string => !!v)),
    );

    groups.push({
      employerKey: key,
      primaryStreamId: primary.id,
      includedStreamIds,
      droppedStreamIds: [],
      uniqueSourceIds,
      overlapDateCount,
      company: primary.company,
      payFrequency: primary.pay_frequency,
      sourceId: primary.source_id,
    });
  }
  return groups;
}

export type YtdW2Entry = {
  income_type: string | null | undefined;
  income_date: string | null | undefined;
  company: string | null | undefined;
  paycheck_amount: number | string | null | undefined;
  taxes_withheld: number | string | null | undefined;
  source_id?: string | null;
  /** YTD catch-up indicators. Catch-up rows are lump-sum onboarding imports
   *  and must NOT be treated as recurring paychecks for per-paycheck averaging. */
  entry_kind?: string | null;
  origin_type?: string | null;
  linked_ytd_catchup_id?: string | null;
};

export type YtdFallbackRow = {
  streamId: string;
  employerKey: string;
  company: string;
  payFrequency: string;
  detectedFrequency: string | null;
  lastPaycheckDate: string | null;
  remainingPaychecks: number;
  remainingGross: number;
  expectedNormalWithholding: number;
  streamIds: string[];
  droppedStreamIds: string[];
  uniqueSourceIds: string[];
  overlapDateCount: number;
  /** Per-paycheck averages computed from RECURRING paychecks only (excludes
   *  YTD catch-up lump-sum rows). Zero when only catch-up entries exist. */
  __ytdAvgGross: number;
  __ytdAvgWithheld: number;
  /** YTD totals across ALL W-2 entries for this employer (incl. catch-up). */
  __ytdGrossTotal: number;
  __ytdWithheldTotal: number;
  __isYtdFallback: true;
};

/** YTD catch-up rows are lump-sum onboarding imports — never recurring paychecks. */
function isYtdCatchupEntry(e: YtdW2Entry): boolean {
  return (
    e.entry_kind === "ytd_catchup" ||
    e.origin_type === "ytd_catchup" ||
    !!e.linked_ytd_catchup_id
  );
}

/**
 * Build best-effort W-4 employer rows from this year's W-2 income entries.
 * Used by the W-4 Calculator when the user has not set up projected income
 * streams yet (e.g. YTD-only onboarding). Frequency is inferred from paycheck
 * dates per employer; per-paycheck gross/withholding averages drive the
 * projected remaining amounts in `effectiveRows` downstream.
 *
 * YTD catch-up entries are EXCLUDED from per-paycheck averaging (they would
 * otherwise massively inflate avg-per-paycheck and project as $$$ recurring
 * income). They still count toward `__ytdGrossTotal` / `__ytdWithheldTotal`.
 */
export function buildYtdFallbackEmployerRows(
  entries: YtdW2Entry[] | null | undefined,
  today: Date = new Date(),
): YtdFallbackRow[] {
  const year = today.getFullYear().toString();
  const w2Entries = (entries || []).filter(
    (e) =>
      typeof e.income_type === "string" &&
      isW2FilingType(e.income_type) &&
      typeof e.income_date === "string" &&
      e.income_date.startsWith(year),
  );
  if (w2Entries.length === 0) return [];

  type Group = {
    company: string;
    recurringDates: string[];
    recurringGross: number;
    recurringWithheld: number;
    grossYtdTotal: number;
    withheldYtdTotal: number;
    sourceIds: string[];
  };
  const groups = new Map<string, Group>();
  for (const e of w2Entries) {
    const sid = (e.source_id as string | null) || null;
    const company = e.company || "Employer";
    const key = sid || `name:${normalizeEmployerName(company)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        company,
        recurringDates: [],
        recurringGross: 0,
        recurringWithheld: 0,
        grossYtdTotal: 0,
        withheldYtdTotal: 0,
        sourceIds: [],
      };
      groups.set(key, g);
    }
    const gross = Number(e.paycheck_amount) || 0;
    const withheld = Number(e.taxes_withheld) || 0;
    g.grossYtdTotal += gross;
    g.withheldYtdTotal += withheld;
    if (!isYtdCatchupEntry(e)) {
      g.recurringDates.push(e.income_date as string);
      g.recurringGross += gross;
      g.recurringWithheld += withheld;
    }
    if (sid && !g.sourceIds.includes(sid)) g.sourceIds.push(sid);
  }

  return Array.from(groups.entries()).map(([key, g]) => {
    const det = detectFrequencyFromDates(g.recurringDates);
    const recurringCount = g.recurringDates.length;
    const avgGross = recurringCount > 0 ? g.recurringGross / recurringCount : 0;
    const avgWithheld = recurringCount > 0 ? g.recurringWithheld / recurringCount : 0;
    return {
      streamId: `ytd:${key}`,
      employerKey: `ytd:${key}`,
      company: g.company,
      payFrequency: det.frequency || "biweekly",
      detectedFrequency: det.frequency,
      lastPaycheckDate: det.lastDate,
      remainingPaychecks: 0,
      remainingGross: 0,
      expectedNormalWithholding: 0,
      streamIds: [],
      droppedStreamIds: [],
      uniqueSourceIds: g.sourceIds,
      overlapDateCount: 0,
      __ytdAvgGross: avgGross,
      __ytdAvgWithheld: avgWithheld,
      __ytdGrossTotal: g.grossYtdTotal,
      __ytdWithheldTotal: g.withheldYtdTotal,
      __isYtdFallback: true,
    };
  });
}

/**
 * Build placeholder W-4 employer rows for saved W-2 companies that are not
 * already represented in the stream- or YTD-derived rows. This ensures the
 * W-4 Calculator renders rows for every W-2 employer the user saved in
 * Settings, even when no active projected income streams or YTD entries
 * exist yet. Saved company settings (projectedAnnualGross /
 * expectedFederalWithholdingPerPaycheck) are applied downstream in the
 * `effectiveRows` override pass.
 */
export type CompanyEmployerInput = {
  name: string;
  companyType: string;
  payFrequency: string | null;
};

export function buildCompanyOnlyEmployerRows(
  companies: CompanyEmployerInput[] | null | undefined,
  existingEmployerKeys: Set<string>,
): YtdFallbackRow[] {
  const out: YtdFallbackRow[] = [];
  const seen = new Set(existingEmployerKeys);
  for (const c of companies || []) {
    const ft = normalizeFilingType(c.companyType);
    if (ft !== "w2" && ft !== "scorp_w2") continue;
    const norm = normalizeEmployerName(c.name);
    if (!norm) continue;
    const key = `emp:${norm}|w2`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      streamId: key,
      employerKey: key,
      company: c.name,
      payFrequency: c.payFrequency || "biweekly",
      detectedFrequency: null,
      lastPaycheckDate: null,
      remainingPaychecks: 0,
      remainingGross: 0,
      expectedNormalWithholding: 0,
      streamIds: [],
      droppedStreamIds: [],
      uniqueSourceIds: [],
      overlapDateCount: 0,
      __ytdAvgGross: 0,
      __ytdAvgWithheld: 0,
      __ytdGrossTotal: 0,
      __ytdWithheldTotal: 0,
      __isYtdFallback: true,
    });
  }
  return out;
}




export type Allocation = EmployerRow & {
  exactPerPaycheck: number;
  exactEmployerGap: number;
  step4cPerPaycheck: number;
  employerGap: number;
};

export function computeAllocations(
  employerRows: EmployerRow[],
  remainingW4Gap: number,
  totalRemainingW2Gross: number,
): Allocation[] {
  if (!employerRows || employerRows.length === 0) return [];
  const activeRows = employerRows.filter((r) => r.remainingPaychecks > 0);
  if (activeRows.length === 0) return [];
  if (!isFinite(remainingW4Gap) || remainingW4Gap <= 0) {
    return activeRows.map((r) => ({
      ...r,
      exactPerPaycheck: 0,
      exactEmployerGap: 0,
      step4cPerPaycheck: 0,
      employerGap: 0,
    }));
  }

  const base: Allocation[] = activeRows.map((r) => {
    const share =
      activeRows.length === 1
        ? 1
        : totalRemainingW2Gross > 0
          ? r.remainingGross / totalRemainingW2Gross
          : 1 / activeRows.length;
    const employerGap = remainingW4Gap * share;
    const perPaycheck = r.remainingPaychecks > 0 ? employerGap / r.remainingPaychecks : 0;
    const step4c = Math.max(0, roundToNearest5(perPaycheck));
    return {
      ...r,
      exactPerPaycheck: perPaycheck,
      exactEmployerGap: employerGap,
      step4cPerPaycheck: step4c,
      employerGap: step4c * r.remainingPaychecks,
    };
  });

  // Bounded greedy adjustment: at each step, pick the ±$5 change to any
  // employer that most reduces |diff|. Stop when no change helps, or after
  // a hard iteration cap so we can never loop indefinitely.
  let totalRounded = base.reduce((s, a) => s + a.employerGap, 0);
  const maxIters = base.length * 40 + 20;
  for (let iter = 0; iter < maxIters; iter++) {
    const diff = remainingW4Gap - totalRounded;
    if (Math.abs(diff) < 2.5) break;
    let bestIdx = -1;
    let bestDelta = 0; // signed $5 change to apply
    let bestNewAbsDiff = Math.abs(diff);
    for (let i = 0; i < base.length; i++) {
      const a = base[i];
      if (a.remainingPaychecks <= 0) continue;
      for (const inc of [5, -5]) {
        const nextVal = a.step4cPerPaycheck + inc;
        if (nextVal < 0) continue;
        const newTotal = totalRounded + inc * a.remainingPaychecks;
        const newAbs = Math.abs(remainingW4Gap - newTotal);
        if (newAbs + 0.0001 < bestNewAbsDiff) {
          bestNewAbsDiff = newAbs;
          bestIdx = i;
          bestDelta = inc;
        }
      }
    }
    if (bestIdx < 0) break;
    base[bestIdx].step4cPerPaycheck += bestDelta;
    base[bestIdx].employerGap =
      base[bestIdx].step4cPerPaycheck * base[bestIdx].remainingPaychecks;
    totalRounded += bestDelta * base[bestIdx].remainingPaychecks;
  }

  return base;
}

/**
 * Inputs to the main W-4 remaining-gap formula. Pure, exported, and unit-
 * testable so regressions like "projected future W-2 withholding shown as $0
 * even though employer rows project nonzero withholding" cannot return.
 *
 * Federal income tax only. FICA (Social Security / Medicare) and SE tax must
 * not be passed in via any of these terms.
 */
export type W4GapInputs = {
  projectedAnnualFederalTax: number;
  /** Actual YTD federal + state withholding already deducted from paychecks. */
  actualWithheldYtd: number;
  /** Sum of `expectedNormalWithholding` across the final effective employer
   *  rows shown in the W-4 table. Drives the visible "Projected future W-2
   *  withholding" line as well as the gap formula — they MUST match. */
  projectedFutureFederalW2Withholding: number;
  /** User-entered tax savings actually set aside / paid. */
  actualTaxSavedOrPaid: number;
  /** Estimated tax payments actually made YTD. */
  estimatedPaymentsMade: number;
  /** Planned future 1099/business/K-1 reserves counted toward gap (0 when toggle off). */
  plannedFutureNonW2ReservesCounted: number;
};

/** Signed annual gap; positive = under-withheld, negative = over-withheld. */
export function computeSignedW4Gap(inp: W4GapInputs): number {
  return (
    inp.projectedAnnualFederalTax -
    inp.actualWithheldYtd -
    inp.actualTaxSavedOrPaid -
    inp.estimatedPaymentsMade -
    inp.projectedFutureFederalW2Withholding -
    inp.plannedFutureNonW2ReservesCounted
  );
}

/** Floored-at-zero remaining gap allocated across remaining W-2 paychecks. */
export function computeRemainingW4Gap(inp: W4GapInputs): number {
  return Math.max(0, computeSignedW4Gap(inp));
}

export default function W4PaycheckAdjustmentCard() {
  const { actualEstimate, currentPaceEstimate, forecastEstimate, forecastDebug, actualDebug } = useTaxEstimate();
  const { data: settings } = useTaxSettings();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: transactions } = useTransactions();

  // Resolve an employee label (primary user vs spouse) for each W-2 employer.
  // Source of truth: companies.employee_role saved in Settings, keyed by
  // company id (source_id). Falls back to ui_income_subtype on the most
  // recent income entry when the company role is unset (legacy data).
  const employeeBySourceId = useMemo(() => {
    const map = new Map<string, "primary" | "spouse">();
    // 1) Seed from saved companies (Settings is the source of truth).
    for (const c of companies || []) {
      const ft = normalizeFilingType(c.companyType);
      if (ft !== "w2" && ft !== "scorp_w2") continue;
      if (c.employeeRole === "primary" || c.employeeRole === "spouse") {
        map.set(c.id, c.employeeRole);
      }
    }
    // 2) Fall back to ledger ui_income_subtype for source_ids without a role.
    const byDate = [...(incomeEntries || [])].sort((a, b) =>
      (b.income_date || "").localeCompare(a.income_date || ""),
    );
    for (const e of byDate) {
      const sid = (e as any).source_id as string | null;
      if (!sid || map.has(sid)) continue;
      const subtype = ((e as any).ui_income_subtype || (e as any).income_type || "") as string;
      map.set(sid, subtype === "w2_partner" ? "spouse" : "primary");
    }
    return map;
  }, [incomeEntries, companies]);

  // Same resolution but keyed by normalized employer name so company-only
  // placeholder rows (which carry no source_id) still get the correct
  // primary/spouse label.
  const employeeByEmployerName = useMemo(() => {
    const map = new Map<string, "primary" | "spouse">();
    for (const c of companies || []) {
      const ft = normalizeFilingType(c.companyType);
      if (ft !== "w2" && ft !== "scorp_w2") continue;
      if (c.employeeRole === "primary" || c.employeeRole === "spouse") {
        map.set(normalizeEmployerName(c.name), c.employeeRole);
      }
    }
    return map;
  }, [companies]);

  const [showHow, setShowHow] = useState(false);

  const businessRateSel = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "1099",
    taxSettings: settings,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
    includeSETaxInRecommendation: true,
  });
  const businessReserveRate = businessRateSel.rate; // % expected on future 1099/business income

  const todayStr = new Date().toISOString().split("T")[0];

  // Build projected paychecks with full match/override context, then filter to
  // FUTURE, W-2, unconverted/unmatched/active occurrences.
  const allProjected = useMemo(
    () =>
      generateProjectedPaychecks(
        streams || [],
        bonuses || [],
        incomeEntries || [],
        overrides || [],
        plannerConversions || [],
        (transactions || []).map((t) => ({
          id: t.id,
          transaction_date: t.transaction_date,
          vendor: t.vendor || "",
          amount: Number(t.amount) || 0,
          source_id: (t as any).source_id ?? null,
          status: t.status,
          transaction_type: t.transaction_type,
        })),
      ),
    [streams, bonuses, incomeEntries, overrides, plannerConversions, transactions],
  );

  // Per-stream detection from real past paychecks (income entries this year).
  // Keyed by source_id (matches stream.source_id). Streams without a
  // source_id fall back to lookup by stream.id below.
  const detectionBySourceId = useMemo(() => {
    const year = new Date().getFullYear().toString();
    const bySource = new Map<string, string[]>();
    for (const e of incomeEntries || []) {
      const sid = (e as any).source_id as string | null;
      if (!sid) continue;
      const d = e.income_date;
      if (!d || !d.startsWith(year)) continue;
      if (!bySource.has(sid)) bySource.set(sid, []);
      bySource.get(sid)!.push(d);
    }
    const out = new Map<string, { frequency: string | null; lastDate: string | null }>();
    for (const [sid, dates] of bySource) {
      out.set(sid, detectFrequencyFromDates(dates));
    }
    return out;
  }, [incomeEntries]);

  // Per-employer rollup for active W-2 streams
  const employerRows = useMemo(() => {
    const w2Streams = (streams || []).filter((s) => s.is_active && isW2Stream(s));

    // Future, unmatched paycheck dates per stream — drives both dup detection
    // and the per-employer paycheck rollup.
    const futureDatesByStream = new Map<string, Set<string>>();
    for (const p of allProjected) {
      if (p.isSkipped) continue;
      if (p.date <= todayStr) continue;
      if (p.matchStatus === "matched" || p.matchStatus === "converted") continue;
      if (p.type !== "paycheck") continue; // bonuses don't define the schedule
      if (!futureDatesByStream.has(p.streamId)) futureDatesByStream.set(p.streamId, new Set());
      futureDatesByStream.get(p.streamId)!.add(p.date);
    }

    const groups = groupW2StreamsByEmployer(w2Streams, futureDatesByStream);

    return groups.map((g) => {
      // Prefer detection from any source_id in this employer group; fall back
      // to detection keyed by the primary stream id.
      let det: { frequency: string | null; lastDate: string | null } | null = null;
      for (const sid of g.uniqueSourceIds) {
        const d = detectionBySourceId.get(sid);
        if (d && (d.frequency || d.lastDate)) {
          det = d;
          break;
        }
      }
      if (!det) det = detectionBySourceId.get(g.primaryStreamId) ?? null;

      let remainingPaychecks = 0;
      let remainingGross = 0;
      let expectedNormalWithholding = 0;
      const includedSet = new Set(g.includedStreamIds);
      const seenPaycheckDates = new Set<string>();

      // Sum paychecks across all streams in the group, deduping by date so
      // overlapping duplicate schedules don't double-count.
      for (const p of allProjected) {
        if (!includedSet.has(p.streamId)) continue;
        if (p.isSkipped) continue;
        if (p.date <= todayStr) continue;
        if (p.matchStatus === "matched" || p.matchStatus === "converted") continue;
        if (p.type === "paycheck") {
          if (seenPaycheckDates.has(p.date)) continue;
          seenPaycheckDates.add(p.date);
          remainingPaychecks += 1;
        }
        remainingGross += Number(p.grossAmount || 0);
        expectedNormalWithholding += Number(p.taxesWithheld || 0);
      }

      return {
        streamId: g.employerKey,
        employerKey: g.employerKey,
        company: g.company,
        payFrequency: g.payFrequency,
        detectedFrequency: det?.frequency ?? null,
        lastPaycheckDate: det?.lastDate ?? null,
        remainingPaychecks,
        remainingGross,
        expectedNormalWithholding,
        streamIds: g.includedStreamIds,
        droppedStreamIds: g.droppedStreamIds,
        uniqueSourceIds: g.uniqueSourceIds,
        overlapDateCount: g.overlapDateCount,
      };
    });
  }, [streams, allProjected, todayStr, detectionBySourceId]);

  // ── YTD fallback ──
  // When a W-2 user has not yet set up projected income streams (e.g. they
  // only entered YTD W-2 catchup during onboarding), `employerRows` will be
  // empty and the W-4 Calculator would otherwise render nothing. Build a
  // best-effort employer list from this year's W-2 income entries so the tab
  // shows actionable per-employer W-4 guidance based on the federal income
  // tax shortfall.
  const ytdFallbackRows = useMemo(() => {
    if (employerRows.length > 0) return [];
    return buildYtdFallbackEmployerRows(incomeEntries as any);
  }, [employerRows, incomeEntries]);

  // Read per-company W-4 settings from Settings > Companies. Used both to
  // build placeholder rows for saved W-2 companies that have no projected
  // stream or YTD entry yet, and to override projection values downstream.
  const { companies } = useCompanies();

  // Saved W-2 companies always contribute an employer row, even when the
  // user has no active projected income streams or YTD income entries yet.
  // Without this, Settings-only W-2 users would see a blank W-4 tab.
  const companyOnlyRows = useMemo(() => {
    const baseRows = employerRows.length > 0 ? employerRows : ytdFallbackRows;
    const existingKeys = new Set<string>();
    for (const r of baseRows) {
      const k = `emp:${normalizeEmployerName(r.company)}|w2`;
      existingKeys.add(k);
    }
    return buildCompanyOnlyEmployerRows(
      companies.map((c) => ({
        name: c.name,
        companyType: c.companyType,
        payFrequency: c.payFrequency,
      })),
      existingKeys,
    );
  }, [companies, employerRows, ytdFallbackRows]);

  const sourceRows = [
    ...(employerRows.length > 0 ? employerRows : ytdFallbackRows),
    ...companyOnlyRows,
  ];


  // User-facing toggle: whether to assume the user will save the recommended
  // future 1099/business/K-1 tax reserves. Defaults ON because most app users
  // are being told to save reserves from non-W-2 income. Persisted locally so
  // the choice survives reloads without requiring a backend change.
  const TOGGLE_KEY = "w4.countPlannedNonW2Reserves";
  const [countPlannedNonW2Reserves, setCountPlannedNonW2Reserves] = useState<boolean>(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TOGGLE_KEY);
      if (raw === "false") setCountPlannedNonW2Reserves(false);
      else if (raw === "true") setCountPlannedNonW2Reserves(true);
    } catch {
      /* ignore */
    }
  }, []);
  const handleToggleChange = (next: boolean) => {
    setCountPlannedNonW2Reserves(next);
    try {
      localStorage.setItem(TOGGLE_KEY, next ? "true" : "false");
    } catch {
      /* ignore */
    }
  };

  // Future business gross = planner (forecast) gross business − actual gross business
  const futureBusinessGross = Math.max(
    0,
    Number(forecastDebug?.grossBusinessIncome ?? 0) - Number(actualDebug?.grossBusinessIncome ?? 0),
  );
  const projectedPlannedFutureBusinessReserves =
    futureBusinessGross * (businessReserveRate / 100);
  const plannedFutureBusinessReservesCounted = countPlannedNonW2Reserves
    ? projectedPlannedFutureBusinessReserves
    : 0;

  // Per-company W-4 settings map (companies hook called earlier).

  const companyByEmployerKey = useMemo(() => {
    const map = new Map<string, {
      id: string;
      payFrequency: string | null;
      remainingOverride: number | null;
      projectedAnnualGross: number | null;
      expectedFederalWithholdingPerPaycheck: number | null;
    }>();
    for (const c of companies) {
      const ft = normalizeFilingType(c.companyType);
      if (ft !== "w2" && ft !== "scorp_w2") continue;
      const key = `emp:${normalizeEmployerName(c.name)}|w2`;
      const prev = map.get(key);
      const next = {
        id: c.id,
        payFrequency: c.payFrequency,
        remainingOverride: c.remainingPaychecksOverride,
        projectedAnnualGross: c.projectedAnnualGross ?? null,
        expectedFederalWithholdingPerPaycheck:
          c.expectedFederalWithholdingPerPaycheck ?? null,
      };
      // Prefer the entry that has the richest signal.
      if (
        !prev ||
        (!prev.payFrequency && next.payFrequency) ||
        (prev.projectedAnnualGross == null && next.projectedAnnualGross != null) ||
        (prev.expectedFederalWithholdingPerPaycheck == null &&
          next.expectedFederalWithholdingPerPaycheck != null)
      ) {
        map.set(key, next);
      }
    }
    return map;
  }, [companies]);

  // YTD gross/withheld per employer key — used to compute remaining-gross from
  // a saved projected annual gross. Built from this year's W-2 income entries.
  const ytdByEmployerKey = useMemo(() => {
    const year = new Date().getFullYear().toString();
    const map = new Map<string, { gross: number; withheld: number }>();
    for (const e of incomeEntries || []) {
      if (typeof e.income_type !== "string" || !isW2FilingType(e.income_type)) continue;
      const d = (e as any).income_date as string | undefined;
      if (!d || !d.startsWith(year)) continue;
      const key = `emp:${normalizeEmployerName((e as any).company)}|w2`;
      const prev = map.get(key) || { gross: 0, withheld: 0 };
      prev.gross += Number((e as any).paycheck_amount) || 0;
      prev.withheld += Number((e as any).taxes_withheld) || 0;
      map.set(key, prev);
    }
    return map;
  }, [incomeEntries]);

  // Apply company settings to produce effective rows used in allocation.
  // Priority (per spec):
  //   1. Saved expectedFederalWithholdingPerPaycheck * remainingPaychecks
  //   2. Saved projectedAnnualGross minus YTD gross
  //   3. Derived from projected paycheck streams
  //   4. YTD fallback per-paycheck averages (catch-up rows excluded)
  const effectiveRows = useMemo(() => {
    return sourceRows.map((r) => {
      const lookupKey = `emp:${normalizeEmployerName(r.company)}|w2`;
      const settings =
        companyByEmployerKey.get(r.streamId) ||
        companyByEmployerKey.get(lookupKey);
      const autoFrequency = r.detectedFrequency ?? r.payFrequency;
      const frequency = settings?.payFrequency || autoFrequency;
      const detectedPaychecks = r.remainingPaychecks;
      const isYtdFallback = Boolean((r as any).__isYtdFallback);

      let autoPaychecks: number;
      if (r.lastPaycheckDate) {
        autoPaychecks = paychecksFromLastDate(frequency, r.lastPaycheckDate);
      } else if (detectedPaychecks > 0 && !settings?.payFrequency) {
        autoPaychecks = detectedPaychecks;
      } else {
        autoPaychecks = defaultRemainingPaychecks(frequency);
      }

      const remainingPaychecks =
        settings?.remainingOverride != null
          ? Math.max(0, Math.floor(settings.remainingOverride))
          : autoPaychecks;

      const savedAnnualGross = settings?.projectedAnnualGross ?? null;
      const savedFedPerPaycheck =
        settings?.expectedFederalWithholdingPerPaycheck ?? null;
      const ytd = ytdByEmployerKey.get(lookupKey) || { gross: 0, withheld: 0 };

      let remainingGross: number;
      let expectedNormalWithholding: number;

      if (savedAnnualGross != null) {
        // Explicit annual gross wins. Remaining = annual − YTD already received.
        remainingGross = Math.max(0, savedAnnualGross - ytd.gross);
      } else if (isYtdFallback) {
        const avgGross = (r as any).__ytdAvgGross || 0;
        remainingGross = avgGross * remainingPaychecks;
      } else {
        const ratio =
          detectedPaychecks > 0 ? remainingPaychecks / detectedPaychecks : 0;
        remainingGross =
          detectedPaychecks > 0 ? r.remainingGross * ratio : r.remainingGross;
      }

      if (savedFedPerPaycheck != null) {
        expectedNormalWithholding = savedFedPerPaycheck * remainingPaychecks;
      } else if (isYtdFallback) {
        const avgWithheld = (r as any).__ytdAvgWithheld || 0;
        expectedNormalWithholding = avgWithheld * remainingPaychecks;
      } else {
        expectedNormalWithholding = r.expectedNormalWithholding;
      }

      const missingSettings = !settings?.payFrequency;
      const usedSavedSettings =
        savedAnnualGross != null || savedFedPerPaycheck != null;

      // Data-completeness signals (drive W-4 accuracy warnings, not math).
      const ytdGrossTotal =
        Number((r as any).__ytdGrossTotal) || ytd.gross || 0;
      const ytdWithheldTotal =
        Number((r as any).__ytdWithheldTotal) || ytd.withheld || 0;
      const hasYtdData =
        ytdGrossTotal > 0 || ytdWithheldTotal > 0 || detectedPaychecks > 0;
      // "Future projection" = saved annual gross, saved per-paycheck
      // withholding (paired with a known pay frequency), or an active
      // projected stream contributing remaining gross/paychecks.
      const hasSavedFutureSettings =
        savedAnnualGross != null ||
        (savedFedPerPaycheck != null && !!settings?.payFrequency);
      const hasStreamProjection = !isYtdFallback && detectedPaychecks > 0;
      const hasFutureProjection =
        hasSavedFutureSettings || hasStreamProjection || remainingGross > 0;
      // Settings-only future projection (no active income stream backing it).
      // Premium users get a nudge to add a stream for higher accuracy.
      const settingsOnlyFuture = hasSavedFutureSettings && !hasStreamProjection;

      return {
        ...r,
        payFrequency: frequency,
        remainingPaychecks,
        remainingGross,
        expectedNormalWithholding,
        missingSettings,
        isYtdFallback,
        usedSavedSettings,
        hasYtdData,
        hasFutureProjection,
        hasStreamProjection,
        settingsOnlyFuture,
        ytdGrossTotal,
        ytdWithheldTotal,
      };
    });

  }, [sourceRows, companyByEmployerKey, ytdByEmployerKey]);

  const isPremium = (settings?.subscriptionTier || "premium") === "premium";

  // Data-completeness signals used to warn users when the W-4 recommendation
  // may be inaccurate because YTD or future projection data is missing.
  const dataCompleteness = useMemo(() => {
    const totalYtdGross = effectiveRows.reduce(
      (s, r: any) => s + (Number(r.ytdGrossTotal) || 0),
      0,
    );
    const totalYtdWithheld = effectiveRows.reduce(
      (s, r: any) => s + (Number(r.ytdWithheldTotal) || 0),
      0,
    );
    const anyYtd = effectiveRows.some((r: any) => r.hasYtdData);
    const anyFuture = effectiveRows.some((r: any) => r.hasFutureProjection);
    const anyStream = effectiveRows.some((r: any) => r.hasStreamProjection);
    const anySettingsOnlyFuture = effectiveRows.some(
      (r: any) => r.settingsOnlyFuture,
    );
    const missingYtdAggregate =
      effectiveRows.length > 0 && (totalYtdGross <= 0 || totalYtdWithheld <= 0);
    const missingFutureAggregate = effectiveRows.length > 0 && !anyFuture;
    const partialEmployers = effectiveRows.filter(
      (r: any) => !r.hasYtdData || !r.hasFutureProjection,
    );
    const anyPartialEmployer =
      effectiveRows.length > 0 && partialEmployers.length > 0;
    const multipleW2 = effectiveRows.length > 1;
    const allComplete =
      effectiveRows.length > 0 &&
      !missingYtdAggregate &&
      !missingFutureAggregate &&
      !anyPartialEmployer;
    return {
      anyYtd,
      anyFuture,
      anyStream,
      anySettingsOnlyFuture,
      missingYtdAggregate,
      missingFutureAggregate,
      anyPartialEmployer,
      multipleW2,
      allComplete,
    };
  }, [effectiveRows]);

  const totalRemainingW2Gross = effectiveRows.reduce((s, r) => s + r.remainingGross, 0);


  const projectedTotalTax = Number(forecastDebug?.totalEstimatedTax ?? 0);
  const taxesAlreadyWithheld =
    Number(forecastDebug?.actualFederalWithheld ?? 0) +
    Number(forecastDebug?.actualStateWithheld ?? 0);
  const actualTaxSavedOrPaid = Number(forecastDebug?.taxSavingsSetAside ?? 0);
  const estPaymentsAlreadyMade = Number(forecastDebug?.estimatedPaymentsMade ?? 0);
  // Projected future W-2 federal withholding is derived from the SAME effective
  // employer rows shown in the W-4 table (federal only — no state, no FICA),
  // so the displayed breakdown and the gap formula can never disagree.
  // Upstream forecastDebug.projectedFederalWithheld is often $0 for W-2 users
  // whose company settings carry the projection; using it directly would leave
  // future W-2 withholding out of the gap and overstate the W-4 recommendation.
  const expectedFutureNormalW2Withholding = effectiveRows.reduce(
    (s, r) => s + (Number(r.expectedNormalWithholding) || 0),
    0,
  );

  const w4GapInputs: W4GapInputs = {
    projectedAnnualFederalTax: projectedTotalTax,
    actualWithheldYtd: taxesAlreadyWithheld,
    projectedFutureFederalW2Withholding: expectedFutureNormalW2Withholding,
    actualTaxSavedOrPaid,
    estimatedPaymentsMade: estPaymentsAlreadyMade,
    plannedFutureNonW2ReservesCounted: plannedFutureBusinessReservesCounted,
  };
  const remainingW4Gap = computeRemainingW4Gap(w4GapInputs);

  // ── Stable testable summary numbers ──
  // projectedHouseholdGross = full forecast household gross (W-2 + business +
  // other), so audits can verify the full-picture input the W-4 math uses.
  const projectedHouseholdGross = Number(forecastDebug?.totalGrossIncome ?? 0);
  // projectedFederalWithholding = actual YTD federal + projected future federal
  // withholding (derived from the same effective rows that drive the table).
  const projectedFederalWithholding =
    Number(forecastDebug?.actualFederalWithheld ?? 0) +
    expectedFutureNormalW2Withholding;
  const signedAnnualGap = computeSignedW4Gap(w4GapInputs);
  const annualTaxGap = Math.max(0, signedAnnualGap);
  const annualTaxSurplus = Math.max(0, -signedAnnualGap);

  const allocations = useMemo(
    () => computeAllocations(effectiveRows, remainingW4Gap, totalRemainingW2Gross),
    [effectiveRows, totalRemainingW2Gross, remainingW4Gap],
  );

  const totalExtraThroughYearEnd = allocations.reduce(
    (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
    0,
  );

  // Hide card entirely if user has no W-2 streams at all — nothing to recommend.
  if (sourceRows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          Recommended Extra Withholding
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="About recommended plan"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-sm font-medium">Recommended plan</p>
                <p className="mt-1 text-xs">
                  Based on your current income and projected income, if you continue saving{" "}
                  <span className="font-semibold">{businessReserveRate.toFixed(1)}%</span>{" "}
                  from future 1099/business income, here is what to enter on your W-4.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stable, machine-readable W-4 summary outputs. Hidden from sighted
            users (sr-only) but always present so automated audits can assert
            calculator correctness without scraping fragile visual copy. */}
        <div className="sr-only" aria-hidden="true" data-testid="w4-summary-outputs">
          <span data-testid="w4-projected-household-gross" data-value={projectedHouseholdGross}>
            {fmt(projectedHouseholdGross)}
          </span>
          <span data-testid="w4-projected-federal-withholding" data-value={projectedFederalWithholding}>
            {fmt(projectedFederalWithholding)}
          </span>
          <span data-testid="w4-annual-tax-gap" data-value={annualTaxGap}>
            {fmt(annualTaxGap)}
          </span>
          <span data-testid="w4-annual-tax-surplus" data-value={annualTaxSurplus}>
            {fmt(annualTaxSurplus)}
          </span>
          <span data-testid="w4-total-extra-withholding-needed" data-value={totalExtraThroughYearEnd}>
            {fmt(totalExtraThroughYearEnd)}
          </span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Per-paycheck targets can show extra needed on individual checks, but
          W-4 changes are based on your full annual tax picture after counting
          W-2 withholding, estimated payments, actual savings, and optional
          planned non-W-2 reserves.
        </p>
        <p
          className="text-xs text-muted-foreground leading-relaxed"
          data-testid="w4-fica-disclaimer"
        >
          This recommendation only covers federal income tax. Social Security
          and Medicare are handled through payroll and are not added to W-4
          Step 4(c).
        </p>
        {sourceRows.some((r: any) => r.__isYtdFallback) && (
          <p
            className="text-xs text-muted-foreground leading-relaxed"
            data-testid="w4-ytd-estimate-note"
          >
            Remaining paychecks and gross are <span className="font-medium">estimated</span> from your
            year-to-date W-2 entries because you have not set up projected income streams yet.
            Add pay frequency and remaining paychecks in Settings for a more precise recommendation.
          </p>
        )}

        {/* Data-completeness warnings — make it obvious when the W-4 estimate
            may be inaccurate because YTD or future paycheck data is missing.
            These do NOT change the recommendation math; they only explain it. */}
        {(dataCompleteness.missingYtdAggregate ||
          dataCompleteness.missingFutureAggregate ||
          dataCompleteness.anyPartialEmployer ||
          dataCompleteness.multipleW2 ||
          dataCompleteness.anyFuture) && (
          <div className="space-y-2" data-testid="w4-data-warnings">
            {dataCompleteness.missingYtdAggregate && (
              <div
                className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground"
                data-testid="w4-warning-missing-ytd"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                <p>
                  Your W-4 estimate may be inaccurate because YTD paystub
                  information is missing. Go to{" "}
                  <Link
                    to="/settings"
                    className="font-medium underline underline-offset-2"
                  >
                    Settings → W-2 Employers
                  </Link>{" "}
                  and add YTD gross income and YTD federal withholding.
                </p>
              </div>
            )}
            {dataCompleteness.missingFutureAggregate && (
              <div
                className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground"
                data-testid="w4-warning-missing-future"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                <p>
                  Your W-4 estimate may be incomplete because future paycheck
                  information is missing. Go to{" "}
                  <Link
                    to="/settings"
                    className="font-medium underline underline-offset-2"
                  >
                    Settings → W-2 Employers
                  </Link>{" "}
                  and add projected annual income, pay frequency, and expected
                  federal withholding per paycheck.
                </p>
              </div>
            )}
            {dataCompleteness.anyPartialEmployer &&
              !dataCompleteness.missingYtdAggregate &&
              !dataCompleteness.missingFutureAggregate && (
                <div
                  className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground"
                  data-testid="w4-warning-partial-employer"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                  <p>
                    One or more W-2 employers is missing YTD or future paycheck
                    information.{" "}
                    <Link
                      to="/settings"
                      className="font-medium underline underline-offset-2"
                    >
                      Open Settings → W-2 Employers
                    </Link>{" "}
                    to fill in the missing values.
                  </p>
                </div>
              )}
            {/* Tier-aware data-source message. Tells the user where the W-4
                future projection is coming from and (for premium) nudges
                Income Streams as the more accurate path. */}
            {dataCompleteness.anyFuture && !isPremium && (
              <div
                className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
                data-testid="w4-source-free"
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  Your W-4 estimate uses manual employer settings. Add
                  projected salary, remaining paychecks, and expected
                  withholding in{" "}
                  <Link
                    to="/settings"
                    className="font-medium underline underline-offset-2"
                  >
                    Settings → W-2 Employers
                  </Link>{" "}
                  for a basic estimate.
                </p>
              </div>
            )}
            {isPremium &&
              dataCompleteness.anyFuture &&
              !dataCompleteness.anyStream && (
                <div
                  className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground"
                  data-testid="w4-source-premium-no-stream"
                >
                  <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <p>
                    Your W-4 estimate is using manual Settings. Add{" "}
                    <Link
                      to="/projected-income"
                      className="font-medium underline underline-offset-2"
                    >
                      Income Streams
                    </Link>{" "}
                    for a more accurate paycheck-by-paycheck projection.
                  </p>
                </div>
              )}
            {isPremium && dataCompleteness.anyStream && (
              <div
                className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs text-foreground"
                data-testid="w4-source-premium-stream"
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-success" />
                <p>
                  Your W-4 estimate is using active Income Streams and your
                  YTD paystub data.
                </p>
              </div>
            )}
            {dataCompleteness.multipleW2 && (
              <div
                className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
                data-testid="w4-multi-employer-note"
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  Multiple W-2 jobs can cause under-withholding because each
                  employer may withhold as if it is your only job. This W-4
                  estimate combines all W-2 income and withholding to check
                  whether extra withholding is needed.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-md border border-border p-3 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="w4-count-nonw2" className="text-sm font-medium text-foreground">
              Count planned 1099/business/K-1 tax reserves
            </Label>
            <p className="text-xs text-muted-foreground">
              When on, we assume you will save the recommended tax reserve from
              future non-W-2 income, so your W-4 only needs to cover the remaining
              gap. When off, your W-4 will try to cover more of your total annual
              tax burden.
            </p>
          </div>
          <Switch
            id="w4-count-nonw2"
            checked={countPlannedNonW2Reserves}
            onCheckedChange={handleToggleChange}
          />
        </div>

        {/* Per-employer W-4 allocation table — always rendered so automated
            audits can locate every W-2 job row regardless of gap/surplus
            state. The label makes it unambiguous that the "Extra" column is
            per paycheck, not annual. */}
        <div
          data-testid="w4-recommendation-table"
          data-row-count={effectiveRows.length}
          data-annual-tax-gap={annualTaxGap}
          data-annual-tax-surplus={annualTaxSurplus}
          className="overflow-x-auto rounded-md border border-border hidden sm:block"
        >
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">Employer</th>
                <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">Employee</th>
                <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">Pay frequency</th>
                <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Remaining paychecks</th>
                <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Projected gross</th>
                <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Projected fed. withholding</th>
                <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Extra / paycheck</th>
              </tr>
            </thead>
            <tbody>
              {effectiveRows.map((r) => {
                const a = allocations.find((x) => x.streamId === r.streamId);
                const perPaycheck = a?.step4cPerPaycheck ?? 0;
                const slug = employerSlug(r.company);
                // Determine employee (primary/spouse) from any source_id that
                // grouped into this employer row.
                const sourceIds = ((r as any).uniqueSourceIds as string[] | undefined) ?? [];
                let employee: "primary" | "spouse" = "primary";
                for (const sid of sourceIds) {
                  const tag = employeeBySourceId.get(sid);
                  if (tag === "spouse") { employee = "spouse"; break; }
                  if (tag === "primary") employee = "primary";
                }
                const employeeLabel = employee === "spouse" ? "Spouse" : "Primary";
                return (
                  <tr
                    key={`tbl-${r.streamId}`}
                    className="border-t border-border"
                    data-testid={`w4-job-row-${slug}`}
                    data-employer={r.company}
                    data-employee={employee}
                    data-frequency={r.payFrequency}
                    data-remaining-paychecks={r.remainingPaychecks}
                    data-projected-gross={r.remainingGross}
                    data-projected-fed-withholding={r.expectedNormalWithholding}
                    data-extra-per-paycheck={perPaycheck}
                  >
                    <td className="px-2 py-1.5 text-foreground truncate max-w-[160px]">{r.company}</td>
                    <td className="px-2 py-1.5 text-foreground" data-testid={`w4-job-employee-${slug}`}>{employeeLabel}</td>
                    <td className="px-2 py-1.5 text-foreground" data-testid={`w4-job-frequency-${slug}`}>
                      {formatFrequencyLabel(r.payFrequency).replace(" paycheck", "")}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums" data-testid={`w4-job-remaining-paychecks-${slug}`}>
                      {r.remainingPaychecks}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums" data-testid={`w4-job-projected-gross-${slug}`}>
                      {fmt(r.remainingGross)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums" data-testid={`w4-job-projected-fed-withholding-${slug}`}>
                      {fmt(r.expectedNormalWithholding)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-primary" data-testid={`w4-job-extra-per-paycheck-${slug}`}>
                      {fmt(perPaycheck)} <span className="text-[10px] font-normal text-muted-foreground">/ paycheck</span>
                    </td>
                  </tr>
                );
              })}
              {effectiveRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                    No active W-2 employers to allocate withholding across.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="px-2 py-1.5 text-[10px] text-muted-foreground border-t border-border">
            Extra column is the recommended additional withholding <span className="font-semibold">per paycheck</span> (not annual).
          </p>
        </div>

        {/* Mobile employer cards — same data as the table, collapsed for small screens */}
        <div className="sm:hidden space-y-3">
          {effectiveRows.map((r) => {
            const a = allocations.find((x) => x.streamId === r.streamId);
            const perPaycheck = a?.step4cPerPaycheck ?? 0;
            const slug = employerSlug(r.company);
            const sourceIds = ((r as any).uniqueSourceIds as string[] | undefined) ?? [];
            let employee: "primary" | "spouse" = "primary";
            for (const sid of sourceIds) {
              const tag = employeeBySourceId.get(sid);
              if (tag === "spouse") { employee = "spouse"; break; }
              if (tag === "primary") employee = "primary";
            }
            const employeeLabel = employee === "spouse" ? "Spouse" : "Primary";
            return (
              <div
                key={`mob-${r.streamId}`}
                className="rounded-md border border-border p-3 space-y-2 bg-background"
                data-testid={`w4-mobile-card-${slug}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{r.company}</p>
                    <p className="text-xs text-muted-foreground">{employeeLabel} · {formatFrequencyLabel(r.payFrequency).replace(" paycheck", "")}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-semibold tabular-nums text-primary">{fmt(perPaycheck)}</p>
                    <p className="text-[10px] text-muted-foreground">extra / paycheck</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Remaining</p>
                    <p className="font-medium tabular-nums text-foreground">{r.remainingPaychecks}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Projected gross</p>
                    <p className="font-medium tabular-nums text-foreground">{fmt(r.remainingGross)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fed. withholding</p>
                    <p className="font-medium tabular-nums text-foreground">{fmt(r.expectedNormalWithholding)}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {effectiveRows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active W-2 employers to allocate withholding across.
            </p>
          )}
        </div>


        {remainingW4Gap <= 0 ? (
          <div className="space-y-1 text-sm text-foreground">
            <p>
              No W-4 change is recommended because your projected annual tax
              ({fmt(projectedTotalTax)}) is already covered by actual
              withholding ({fmt(taxesAlreadyWithheld)}), expected future W-2
              withholding ({fmt(expectedFutureNormalW2Withholding)}),
              estimated payments ({fmt(estPaymentsAlreadyMade)}), and
              user-entered tax savings ({fmt(actualTaxSavedOrPaid)}).
            </p>
            {projectedPlannedFutureBusinessReserves > 0 && !countPlannedNonW2Reserves && (
              <p className="text-xs text-muted-foreground">
                Note: ~{fmt(projectedPlannedFutureBusinessReserves)} of
                recommended future 1099/business/K-1 reserves is intentionally
                <span className="italic"> not</span> counted as already saved.
                Turn on the toggle below to assume you will save those reserves,
                or enter actual saved/reserved amounts.
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground">
              For your W-2 jobs, enter the following extra withholding amounts in Form W-4 Step 4(c).{" "}
              <span className="text-muted-foreground">
                Annual gap remaining: <span className="font-semibold text-foreground">{fmt(remainingW4Gap)}</span>.
              </span>
            </p>

            <div className="space-y-3">
              {effectiveRows.map((r) => {
                const a = allocations.find((x) => x.streamId === r.streamId);
                const perPaycheck = a?.step4cPerPaycheck ?? 0;
                const annualForEmployer = perPaycheck * r.remainingPaychecks;
                return (
                  <div
                    key={r.streamId}
                    className="rounded-md border border-border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm font-medium text-foreground truncate">{r.company}</p>
                      <div className="text-right shrink-0">
                        <p className="text-base font-semibold tabular-nums text-primary">
                          {fmt(perPaycheck)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">/ paycheck</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Enter in W-4 Step 4(c) · ≈ {fmt(annualForEmployer)} annual
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Based on {formatFrequencyLabel(r.payFrequency).toLowerCase()} and{" "}
                      {r.remainingPaychecks} remaining paycheck{r.remainingPaychecks === 1 ? "" : "s"} this year
                      {r.remainingPaychecks > 0
                        ? ` (annual ${fmt(annualForEmployer)} ÷ ${r.remainingPaychecks} = ${fmt(perPaycheck)} per paycheck).`
                        : "."}
                    </p>
                    {(r as any).missingSettings && (
                      <p className="text-xs text-warning flex items-start gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          <Link to="/settings" className="underline hover:text-foreground">
                            Add paycheck settings in Settings
                          </Link>{" "}
                          to improve this recommendation.
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>
                Total extra W-2 withholding planned through year-end:{" "}
                <span className="font-semibold text-foreground">{fmt(totalExtraThroughYearEnd)}</span>
              </span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="About this estimate"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      This is an estimate based on your current income, projected income, withholding
                      method, and saved/paid tax entries. Confirm changes with your payroll system or
                      the IRS withholding estimator.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
          </>
        )}

        <Collapsible open={showHow} onOpenChange={setShowHow}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground gap-1 px-0">
              <ChevronDown className={cn("h-4 w-4 transition-transform", showHow && "rotate-180")} />
              Show how this was calculated
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-1 rounded-md border border-border p-3 text-sm">
              <Row label="Annual estimated tax liability" value={fmt(projectedTotalTax)} />
              <Row label="Actual W-2 withholding YTD" value={fmt(taxesAlreadyWithheld)} />
              <Row
                label="Projected future W-2 withholding"
                value={fmt(expectedFutureNormalW2Withholding)}
              />
              <Row label="Actual tax saved YTD (user-entered)" value={fmt(actualTaxSavedOrPaid)} />
              <Row label="Estimated payments already made" value={fmt(estPaymentsAlreadyMade)} />
              {(() => {
                const counted = plannedFutureBusinessReservesCounted;
                const recommended = projectedPlannedFutureBusinessReserves;
                const sameAmount = Math.abs(counted - recommended) < 0.5;
                if (countPlannedNonW2Reserves && sameAmount) {
                  // Toggle on and counted equals recommended — show once.
                  return (
                    <Row
                      label={`Planned future 1099/business/K-1 reserves (${businessReserveRate.toFixed(1)}%)`}
                      value={fmt(counted)}
                    />
                  );
                }
                return (
                  <>
                    <Row
                      label={`Planned future 1099/business/K-1 reserves counted (${businessReserveRate.toFixed(1)}%)`}
                      value={
                        countPlannedNonW2Reserves ? fmt(counted) : `${fmt(0)} (toggle off)`
                      }
                    />
                    <Row
                      label="Planned future 1099/business/K-1 reserves recommended"
                      value={fmt(recommended)}
                    />
                  </>
                );
              })()}
              <div className="my-1 border-t border-border" />
              <Row label="Remaining annual W-4 gap" value={fmt(remainingW4Gap)} bold />


              {allocations.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Per employer breakdown</p>
                  {allocations.map((a) => {
                    const row = employerRows.find((r) => r.streamId === a.streamId) as
                      | (EmployerRow & { uniqueSourceIds?: string[]; overlapDateCount?: number })
                      | undefined;
                    const streamCount = row?.streamIds?.length ?? 1;
                    const sourceCount = row?.uniqueSourceIds?.length ?? 0;
                    const overlapCount = row?.overlapDateCount ?? 0;
                    return (
                      <div
                        key={a.streamId}
                        className="rounded-md bg-muted/40 p-2 space-y-1"
                      >
                        <p className="text-xs font-medium text-foreground">{a.company}</p>
                        <RowSmall
                          label="Expected normal W-2 withholding (projected)"
                          value={fmt(a.expectedNormalWithholding)}
                        />
                        <RowSmall
                          label="Allocated share of remaining gap"
                          value={fmt(a.employerGap)}
                        />
                        <RowSmall
                          label="Step 4(c) extra withholding per paycheck"
                          value={`${fmt(a.step4cPerPaycheck)} / paycheck`}
                        />
                        <p className="text-[10px] text-muted-foreground/80">
                          Employer: <span className="font-medium">{a.company}</span> · key:{" "}
                          <span className="font-mono">{a.streamId}</span> · streams: {streamCount}
                          {" · "}source IDs: {sourceCount}
                          {overlapCount > 0 ? ` · overlapping dates ignored: ${overlapCount}` : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 text-xs text-muted-foreground">
                Allocated across {allocations.length} W-2 job{allocations.length === 1 ? "" : "s"} by
                remaining paycheck schedule and remaining gross W-2 income.
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={cn("text-muted-foreground", bold && "text-foreground font-medium")}>{label}</span>
      <span className={cn("tabular-nums", bold ? "font-semibold text-foreground" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function RowSmall({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
