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
import { normalizeFilingType } from "@/lib/filingTypes";

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

export default function W4PaycheckAdjustmentCard() {
  const { actualEstimate, currentPaceEstimate, forecastEstimate, forecastDebug, actualDebug } = useTaxEstimate();
  const { data: settings } = useTaxSettings();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: transactions } = useTransactions();

  // Resolve an employee label (primary user vs spouse) for each W-2 employer
  // from the most recent income entry tied to that employer's source_id.
  // ui_income_subtype "w2_partner" → Spouse, otherwise Primary.
  const employeeBySourceId = useMemo(() => {
    const map = new Map<string, "primary" | "spouse">();
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
  }, [incomeEntries]);

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

  const projectedTotalTax = Number(forecastDebug?.totalEstimatedTax ?? 0);
  const taxesAlreadyWithheld =
    Number(forecastDebug?.actualFederalWithheld ?? 0) +
    Number(forecastDebug?.actualStateWithheld ?? 0);
  const actualTaxSavedOrPaid = Number(forecastDebug?.taxSavingsSetAside ?? 0);
  const estPaymentsAlreadyMade = Number(forecastDebug?.estimatedPaymentsMade ?? 0);
  const expectedFutureNormalW2Withholding =
    Number(forecastDebug?.projectedFederalWithheld ?? 0) +
    Number(forecastDebug?.projectedStateWithheld ?? 0);

  const remainingW4Gap = Math.max(
    0,
    projectedTotalTax -
      taxesAlreadyWithheld -
      actualTaxSavedOrPaid -
      estPaymentsAlreadyMade -
      expectedFutureNormalW2Withholding -
      plannedFutureBusinessReservesCounted,
  );

  // ── Stable testable summary numbers ──
  // projectedHouseholdGross = full forecast household gross (W-2 + business +
  // other), so audits can verify the full-picture input the W-4 math uses.
  const projectedHouseholdGross = Number(forecastDebug?.totalGrossIncome ?? 0);
  // projectedFederalWithholding = actual YTD federal + projected future federal
  // withholding (excludes state on purpose so the testid name matches reality).
  const projectedFederalWithholding =
    Number(forecastDebug?.actualFederalWithheld ?? 0) +
    Number(forecastDebug?.projectedFederalWithheld ?? 0);
  // Signed annual gap: positive when under-withheld, negative when over.
  const signedAnnualGap =
    projectedTotalTax -
    taxesAlreadyWithheld -
    actualTaxSavedOrPaid -
    estPaymentsAlreadyMade -
    expectedFutureNormalW2Withholding -
    plannedFutureBusinessReservesCounted;
  const annualTaxGap = Math.max(0, signedAnnualGap);
  const annualTaxSurplus = Math.max(0, -signedAnnualGap);

  // Read per-company W-4 settings from Settings > Companies.
  const { companies } = useCompanies();
  const companyByEmployerKey = useMemo(() => {
    const map = new Map<string, { id: string; payFrequency: string | null; remainingOverride: number | null }>();
    for (const c of companies) {
      const ft = normalizeFilingType(c.companyType);
      if (ft !== "w2" && ft !== "scorp_w2") continue;
      const key = `emp:${normalizeEmployerName(c.name)}|w2`;
      // Prefer the entry that has a pay frequency set, otherwise first seen.
      const prev = map.get(key);
      if (!prev || (!prev.payFrequency && c.payFrequency)) {
        map.set(key, {
          id: c.id,
          payFrequency: c.payFrequency,
          remainingOverride: c.remainingPaychecksOverride,
        });
      }
    }
    return map;
  }, [companies]);

  // Apply company settings to produce effective rows used in allocation.
  const effectiveRows = useMemo(() => {
    return employerRows.map((r) => {
      const settings = companyByEmployerKey.get(r.streamId);
      const autoFrequency = r.detectedFrequency ?? r.payFrequency;
      const frequency = settings?.payFrequency || autoFrequency;
      const detectedPaychecks = r.remainingPaychecks;

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
      const ratio =
        detectedPaychecks > 0 ? remainingPaychecks / detectedPaychecks : 0;
      const remainingGross =
        detectedPaychecks > 0 ? r.remainingGross * ratio : r.remainingGross;
      const missingSettings = !settings?.payFrequency;
      return {
        ...r,
        payFrequency: frequency,
        remainingPaychecks,
        remainingGross,
        missingSettings,
      };
    });
  }, [employerRows, companyByEmployerKey]);

  const totalRemainingW2Gross = effectiveRows.reduce((s, r) => s + r.remainingGross, 0);

  const allocations = useMemo(
    () => computeAllocations(effectiveRows, remainingW4Gap, totalRemainingW2Gross),
    [effectiveRows, totalRemainingW2Gross, remainingW4Gap],
  );

  const totalExtraThroughYearEnd = allocations.reduce(
    (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
    0,
  );

  // Hide card entirely if user has no W-2 streams at all — nothing to recommend.
  if (employerRows.length === 0) return null;

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
          className="overflow-x-auto rounded-md border border-border"
        >
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-2 py-1.5">Employer</th>
                <th className="text-left font-medium px-2 py-1.5">Employee</th>
                <th className="text-left font-medium px-2 py-1.5">Pay frequency</th>
                <th className="text-right font-medium px-2 py-1.5">Remaining paychecks</th>
                <th className="text-right font-medium px-2 py-1.5">Projected gross</th>
                <th className="text-right font-medium px-2 py-1.5">Projected fed. withholding</th>
                <th className="text-right font-medium px-2 py-1.5">Extra / paycheck</th>
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
