import * as React from "react";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, AlertCircle, Info, ArrowUp, ArrowDown, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { Input } from "@/components/ui/input";
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
import { getCanonicalBucketRatePct, buildAllocationFromEstimate } from "@/lib/canonicalEventRecommendation";
import { buildSourceFundingPlan } from "@/lib/sourceFundingPlan";
import { getFederalIncomeTaxWithheld } from "@/lib/federalWithholding";

import { normalizeFilingType, isW2FilingType } from "@/lib/filingTypes";
import {
  buildEmployerW4Recommendations,
  resolveCurrentExtraW4,
  allocateW4SurplusReduction,
  stabilizeW4Targets,
} from "@/lib/w4CurrentWithholding";

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
    case "irregular":
      // Irregular / locums / per-diem: no scheduled paychecks; user enters manually.
      return 0;
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
export function isYtdCatchupEntry(e: YtdW2Entry): boolean {
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

/**
 * W-4 Calculator card.
 *
 * PRESENTATION ONLY. Every number shown here comes from `useW4Calculation`,
 * the single canonical W-4 calculation path. The card must never recompute
 * gaps, allocations, funding, or employer targets — duplicated math is what
 * previously produced stale/mismatched displays.
 */
export default function W4PaycheckAdjustmentCard() {
  const {
    effectiveRows,
    employerW4Recommendations,
    remainingW4Gap,
    countPlannedNonW2Reserves,
    setCountPlannedNonW2Reserves,
    projectedHouseholdGross,
    projectedFederalWithholding,
    annualTaxGap,
    annualTaxSurplus,
    totalExtraThroughYearEnd,
    projectedTotalTax,
    taxesAlreadyWithheld,
    actualTaxSavedOrPaid,
    estimatedPaymentsMade,
    projectedFutureBaselineW2Withholding,
    currentExtraW4FutureWithholding,
    plannedFutureBusinessReservesCounted,
    hasNonW2Income,
  } = useW4Calculation();
  const { updateCompany } = useCompanies();

  const [showHow, setShowHow] = useState(false);

  // Display aliases for the canonical hook values.
  const expectedFutureNormalW2Withholding = projectedFutureBaselineW2Withholding;
  const estPaymentsAlreadyMade = estimatedPaymentsMade;
  const handleToggleChange = setCountPlannedNonW2Reserves;

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
    const anyFuture = effectiveRows.some((r: any) => r.hasFutureProjection);
    const missingYtdAggregate =
      effectiveRows.length > 0 && (totalYtdGross <= 0 || totalYtdWithheld <= 0);
    const missingFutureAggregate = effectiveRows.length > 0 && !anyFuture;
    const anyPartialEmployer =
      effectiveRows.length > 0 &&
      effectiveRows.some((r: any) => !r.hasYtdData || !r.hasFutureProjection);
    return {
      anyYtd: effectiveRows.some((r: any) => r.hasYtdData),
      anyFuture,
      anyStream: effectiveRows.some((r: any) => r.hasStreamProjection),
      anySettingsOnlyFuture: effectiveRows.some((r: any) => r.settingsOnlyFuture),
      missingYtdAggregate,
      missingFutureAggregate,
      anyPartialEmployer,
      multipleW2: effectiveRows.length > 1,
      allComplete:
        effectiveRows.length > 0 &&
        !missingYtdAggregate &&
        !missingFutureAggregate &&
        !anyPartialEmployer,
    };
  }, [effectiveRows]);

  // Hide card entirely if user has no W-2 employers at all.
  if (effectiveRows.length === 0) return null;

  const w4Recs = employerW4Recommendations;

  const employerRecs = w4Recs.map((rec) => ({
    row: rec.row,
    perPaycheck: rec.change.recommendedExtraPerPaycheck,
    annualForEmployer: rec.annualRecommendedExtra,
    change: rec.change,
  }));

  const hasAnyDataWarning =
    dataCompleteness.missingYtdAggregate ||
    dataCompleteness.missingFutureAggregate ||
    dataCompleteness.anyPartialEmployer;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Stable, machine-readable W-4 summary outputs for audits. */}
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
          <span data-testid="w4-fica-disclaimer">
            W-4 extra withholding only applies to federal income tax. Social Security and Medicare are handled through payroll.
          </span>
        </div>

        {/* One compact card per active W-2 employer */}
        {employerRecs.length === 0 ? (
          <Card>
            <CardContent className="p-4">
              <p
                className="text-sm text-muted-foreground"
                data-testid="w4-hero-empty"
              >
                No active W-2 employers to show yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="w4-hero">
            {employerRecs.map(({ row: r, perPaycheck, annualForEmployer, change }) => {
              const slug = employerSlug(r.company);
              const onTrack = change.direction === "none";
              return (
                <Card key={`hero-${r.streamId}`} data-testid={`w4-hero-card-${slug}`}>
                  <CardContent className="p-4 space-y-4">
                    {/* Employer identity */}
                    <div className="min-w-0">
                      <p
                        className="text-base font-semibold text-foreground break-words [overflow-wrap:anywhere] leading-snug"
                        title={r.company}
                      >
                        {r.company}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.remainingPaychecks} paycheck
                        {r.remainingPaychecks === 1 ? "" : "s"} remaining
                      </p>
                      <ProjectionSourceLabel row={r as any} slug={slug} />
                    </div>


                    {/* Saved Settings override disclosure — manual overrides
                        stay supported, but must never operate invisibly. */}
                    <SavedOverrideNotice row={r as any} slug={slug} />



                    {/* Current extra W-4 withholding (existing per-employer field) */}
                    <CurrentExtraW4Field
                      slug={slug}
                      companyId={(r as any).companyId ?? null}
                      value={change.currentExtraPerPaycheck}
                      onSave={async (next) => {
                        const cid = (r as any).companyId as string | null;
                        if (!cid) return;
                        await updateCompany(cid, { currentExtraW4Withholding: next });
                      }}
                    />

                    {/* Recommendation + adjustment */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                          PaycheckMD recommendation
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label="About the recommended amount"
                                className="text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">
                                The total amount to enter in Form W-4 Step 4(c) for this
                                employer — extra federal income tax withheld from each
                                paycheck.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-foreground leading-tight mt-1">
                          {fmt(perPaycheck)}
                        </p>
                        <p className="text-xs text-muted-foreground">per paycheck</p>
                      </div>

                      <div
                        className={cn(
                          "rounded-lg border p-3",
                          change.direction === "increase" && "border-warning/40 bg-warning/10",
                          change.direction === "decrease" && "border-success/40 bg-success/10",
                          onTrack && "border-success/40 bg-success/5",
                        )}
                        data-testid={`w4-change-${slug}`}
                        data-direction={change.direction}
                        data-value={change.changeAmountPerPaycheck}
                      >
                        <p className="text-xs font-medium text-muted-foreground">
                          Your adjustment
                        </p>
                        {onTrack ? (
                          <>
                            <p className="text-base font-semibold text-success leading-tight mt-1 flex items-center gap-1.5">
                              <Check className="h-4 w-4 shrink-0" />
                              You&apos;re on track
                            </p>
                            <p className="text-xs text-muted-foreground">
                              No change needed
                            </p>
                            {hasNonW2Income && countPlannedNonW2Reserves && (
                              <p className="text-[11px] text-muted-foreground/80 leading-snug mt-1.5">
                                Assumes you continue making your planned business tax reserves.
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <p
                              className={cn(
                                "text-2xl font-bold tabular-nums leading-tight mt-1 flex items-center gap-1",
                                change.direction === "increase" ? "text-warning" : "text-success",
                              )}
                            >
                              {change.direction === "increase" ? (
                                <ArrowUp className="h-5 w-5 shrink-0" />
                              ) : (
                                <ArrowDown className="h-5 w-5 shrink-0" />
                              )}
                              {fmt(change.changeAmountPerPaycheck)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {change.direction === "increase" ? "Increase" : "Decrease"} per
                              paycheck
                            </p>
                            {hasNonW2Income && (
                              <p className="text-[11px] text-muted-foreground/80 leading-snug mt-1.5">
                                {!countPlannedNonW2Reserves && change.direction === "increase"
                                  ? "If you prefer to cover your remaining tax gap through W-4 withholding."
                                  : countPlannedNonW2Reserves && change.direction === "decrease"
                                    ? "Assumes you continue making your planned business tax reserves."
                                    : null}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Enter the recommended amount in Form W-4 Step 4(c) · about{" "}
                      {fmt(annualForEmployer)} extra this year.
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Lower summary card — secondary details */}
        <Card>
          <CardContent className="p-4 space-y-4">


          {/* Estimated remaining annual gap — secondary to per-paycheck hero */}
          <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
            <span className="text-muted-foreground flex items-center gap-1.5">
              Estimated remaining annual gap
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About estimated remaining annual gap"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    The remaining federal income tax gap after W-2 withholding,
                    estimated payments, saved tax entries, and optional planned
                    non-W-2 reserves.
                  </p>
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="tabular-nums text-muted-foreground">
              {fmt(remainingW4Gap)}
            </span>
          </div>

          {/* Compact non-W-2 reserves toggle — hidden for W-2-only users */}
          {hasNonW2Income && (
            <div className="rounded-md border border-border p-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <Label
                  htmlFor="w4-count-nonw2"
                  className="text-sm font-medium text-foreground"
                >
                  Include business tax reserves
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="About including business tax reserves"
                        className="text-muted-foreground hover:text-foreground transition-colors ml-1 align-middle"
                      >
                        <Info className="h-3.5 w-3.5 inline" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">
                        ON: assume you will continue saving separately for 1099/K-1/business taxes.
                        OFF: do not assume those future savings; show how much of the remaining tax gap could be covered through your W-4s.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Count your planned 1099/K-1/business tax savings toward your tax needs, which may reduce how much extra W-4 withholding you need.
                </p>
              </div>
              <Switch
                id="w4-count-nonw2"
                checked={countPlannedNonW2Reserves}
                onCheckedChange={handleToggleChange}
              />
            </div>
          )}

          {/* Compact data-completeness warning (single line, links to Settings) */}
          {hasAnyDataWarning && (
            <div
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground"
              data-testid="w4-data-warning"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
              <p>
                Some W-2 employer data is missing — this estimate may be
                inaccurate.{" "}
                <Link to="/settings" className="font-medium underline underline-offset-2">
                  Open Settings → W-2 Employers
                </Link>
                .
              </p>
            </div>
          )}

          {/* Multi-W-2 helper tooltip line (compact) */}
          {dataCompleteness.multipleW2 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              Multiple W-2 jobs are included in this estimate.
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About multiple W-2 jobs"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    Multiple W-2 jobs can cause under-withholding because each
                    employer may withhold as if it is your only job.
                  </p>
                </TooltipContent>
              </Tooltip>
            </p>
          )}

          {/* Collapsed calculation details */}
          <Collapsible open={showHow} onOpenChange={setShowHow}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground gap-1 px-0">
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", showHow && "rotate-180")}
                />
                Show calculation details
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-3 rounded-md border border-border p-3">
                <div className="space-y-1">
                  <Row label="Estimated annual tax liability" value={fmt(projectedTotalTax)} />
                  <Row label="Actual W-2 withholding YTD" value={fmt(taxesAlreadyWithheld)} />
                  <Row
                    label="Projected future W-2 withholding"
                    value={fmt(expectedFutureNormalW2Withholding)}
                  />
                  <Row
                    label="Current extra W-4 withholding on remaining paychecks"
                    value={fmt(currentExtraW4FutureWithholding)}
                  />
                  <Row label="Actual tax saved YTD" value={fmt(actualTaxSavedOrPaid)} />
                  <Row
                    label="Estimated payments already made"
                    value={fmt(estPaymentsAlreadyMade)}
                  />
                  <Row
                    label="Planned future 1099/business/K-1 reserves"
                    value={
                      countPlannedNonW2Reserves
                        ? fmt(plannedFutureBusinessReservesCounted)
                        : `${fmt(0)} (toggle off)`
                    }
                  />
                  <div className="my-1 border-t border-border" />
                  <Row label="Remaining annual W-4 gap" value={fmt(remainingW4Gap)} bold />
                </div>

                {employerRecs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">
                      Per employer
                    </p>
                    {/* Desktop table */}
                    <div className="overflow-x-auto rounded-md border border-border hidden sm:block">
                      <table
                        className="w-full text-xs"
                        data-testid="w4-recommendation-table"
                      >
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="text-left font-medium px-2 py-1.5">Employer</th>
                            <th className="text-right font-medium px-2 py-1.5">
                              Extra / paycheck
                            </th>
                            <th className="text-right font-medium px-2 py-1.5">
                              Annual extra
                            </th>
                            <th className="text-right font-medium px-2 py-1.5">
                              Remaining paychecks
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {employerRecs.map(({ row: r, perPaycheck, annualForEmployer }) => {
                            const slug = employerSlug(r.company);
                            return (
                              <tr
                                key={`tbl-${r.streamId}`}
                                className="border-t border-border"
                                data-testid={`w4-job-row-${slug}`}
                              >
                                <td className="px-2 py-1.5 text-foreground break-words max-w-[200px]">
                                  {r.company}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-primary">
                                  {fmt(perPaycheck)}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                  {fmt(annualForEmployer)}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                  {r.remainingPaychecks}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile stacked rows */}
                    <div className="sm:hidden space-y-2">
                      {employerRecs.map(({ row: r, perPaycheck, annualForEmployer }) => {
                        const slug = employerSlug(r.company);
                        return (
                          <div
                            key={`mob-${r.streamId}`}
                            className="rounded-md border border-border p-2 space-y-1"
                            data-testid={`w4-mobile-card-${slug}`}
                          >
                            <p className="text-sm font-medium text-foreground break-words">
                              {r.company}
                            </p>
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Extra / paycheck</span>
                              <span className="font-semibold tabular-nums text-primary">
                                {fmt(perPaycheck)}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Annual extra</span>
                              <span className="tabular-nums text-foreground">
                                {fmt(annualForEmployer)}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">
                                Remaining paychecks
                              </span>
                              <span className="tabular-nums text-foreground">
                                {r.remainingPaychecks}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

            <p className="text-xs text-muted-foreground">
              Recommendations use your current tax estimate and planned income so they
              can adjust as your income changes.
            </p>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>

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

/**
 * Subtle source label: which existing data source drives this employer's
 * future paycheck assumptions. Display only.
 */
function ProjectionSourceLabel({
  row,
  slug,
}: {
  row: { projectionSource?: "planner" | "settings" | "history" };
  slug: string;
}) {
  const source = row.projectionSource ?? "history";
  const text =
    source === "planner"
      ? "Using Income Planner"
      : source === "settings"
        ? "Using W-4 Settings"
        : "Using recent paycheck history";
  const link =
    source === "planner"
      ? { to: "/projected-income", label: "View in Income Planner" }
      : { to: "/settings", label: "Edit in Settings" };
  return (
    <p
      className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5"
      data-testid={`w4-projection-source-${slug}`}
      data-source={source}
    >
      <span>{text}</span>
      <Link to={link.to} className="font-medium text-primary hover:underline">
        {link.label}
      </Link>
    </p>
  );
}

/**

 * Small, secondary disclosure shown when a company's saved W-4 / paycheck
 * Settings estimate is the value actually driving this employer's W-4
 * projection (instead of Planner/actual-derived data).
 *
 * Display only — it reads values already computed in `effectiveRows` and
 * changes no math or source precedence.
 */
function SavedOverrideNotice({
  row,
  slug,
}: {
  row: {
    savedFedPerPaycheckOverride?: number | null;
    savedAnnualGrossOverride?: number | null;
    recentActualFedPerPaycheck?: number | null;
    recentActualGrossPerPaycheck?: number | null;
  };
  slug: string;
}) {
  const savedFed = row.savedFedPerPaycheckOverride ?? null;
  const savedGross = row.savedAnnualGrossOverride ?? null;
  if (savedFed == null && savedGross == null) return null;

  const actualFed = row.recentActualFedPerPaycheck ?? null;
  const actualGross = row.recentActualGrossPerPaycheck ?? null;

  return (
    <div
      className="rounded-md border border-border bg-muted/30 px-2.5 py-2 space-y-1"
      data-testid={`w4-saved-override-${slug}`}
    >
      {savedFed != null && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Using your saved Settings estimate of {fmt(savedFed)} federal withholding
          per paycheck.
          {actualFed != null && actualFed > 0
            ? ` Recent actual federal withholding is about ${fmt(actualFed)}/paycheck.`
            : ""}
        </p>
      )}
      {savedGross != null && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Using your saved Settings estimate of {fmt(savedGross)} annual gross pay.
          {actualGross != null && actualGross > 0
            ? ` Recent actual gross pay is about ${fmt(actualGross)}/paycheck.`
            : ""}
        </p>
      )}
      <Link
        to="/settings"
        className="text-[11px] font-medium text-primary hover:underline inline-block"
      >
        Edit in Settings
      </Link>
    </div>
  );
}



/**
 * Employer-specific "Current Extra W-4 Withholding per Paycheck" editor.
 * Stored per company, so one employer's entry never affects another's
 * recommendation.
 */
function CurrentExtraW4Field({
  slug,
  companyId,
  value,
  onSave,
}: {
  slug: string;
  companyId: string | null;
  value: number;
  onSave: (next: number) => Promise<void> | void;
}) {
  const [draft, setDraft] = React.useState(value ? String(value) : "");
  React.useEffect(() => {
    setDraft(value ? String(value) : "");
  }, [value]);

  if (!companyId) {
    return (
      <p className="text-xs text-muted-foreground">
        Save this employer in Settings to record what you already have on its W-4.
      </p>
    );
  }

  const commit = () => {
    const n = draft.trim() === "" ? 0 : Number(draft);
    const next = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    if (next !== value) void onSave(next);
    setDraft(next ? String(next) : "");
  };

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={`current-extra-w4-${slug}`}
        className="text-xs font-medium text-muted-foreground"
      >
        Current extra W-4 withholding
      </label>
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-[11rem]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            id={`current-extra-w4-${slug}`}
            data-testid={`w4-current-extra-${slug}`}
            inputMode="decimal"
            type="number"
            min={0}
            step="1"
            placeholder="0.00"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="h-11 pl-7 bg-background tabular-nums"
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          per paycheck
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter the extra withholding currently on this employer&apos;s W-4 (Step 4(c)).
        Enter $0 if none.
      </p>
    </div>
  );

}
