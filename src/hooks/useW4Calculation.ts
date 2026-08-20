/**
 * useW4Calculation
 *
 * Shared W-4 annual gap calculation. Extracted from W4PaycheckAdjustmentCard
 * so both the W-4 Calculator card and the Personal Income paycheck guide can
 * use the SAME annual-gap value without duplicating logic. The Personal
 * Income page uses it to decide whether to surface "no extra W-4 withholding
 * recommended" vs a W-4-style per-paycheck extra.
 *
 * Returns the same `effectiveRows`, `allocations`, `signedAnnualGap`,
 * `remainingW4Gap` (= floored at 0), and `totalExtraThroughYearEnd` that the
 * W-4 card already shows; PersonalIncome only consumes the summary fields.
 */
import { useEffect, useMemo, useState } from "react";
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
import { getFederalIncomeTaxWithheld } from "@/lib/federalWithholding";
import { getCanonicalBucketRatePct, buildAllocationFromEstimate } from "@/lib/canonicalEventRecommendation";
import {
  buildSourceFundingPlan,
  type SourceFundingPlan,
} from "@/lib/sourceFundingPlan";
import {
  buildW4Reconciliation,
  computeEligibleFutureBusinessReserves,
  type W4Reconciliation,
} from "@/lib/w4Reconciliation";


import { normalizeFilingType, isW2FilingType } from "@/lib/filingTypes";
import {
  buildEmployerW4Recommendations,
  allocateStableW4Targets,
  resolveCurrentExtraW4,
  type EmployerW4Recommendation,
} from "@/lib/w4CurrentWithholding";
import {
  buildYtdFallbackEmployerRows,
  buildCompanyOnlyEmployerRows,
  computeAllocations,
  defaultRemainingPaychecks,
  detectFrequencyFromDates,
  groupW2StreamsByEmployer,
  isYtdCatchupEntry,
  normalizeEmployerName,
  paychecksFromLastDate,
  type Allocation,
  type W4GapInputs,
} from "@/components/tax/W4PaycheckAdjustmentCard";

function isW2Stream(s: ProjectedIncomeStream): boolean {
  const ft = normalizeFilingType(s.company_type);
  return ft === "w2" || ft === "scorp_w2";
}

export interface W4CalculationResult {
  effectiveRows: any[];
  allocations: Allocation[];
  signedAnnualGap: number;
  remainingW4Gap: number;
  totalExtraThroughYearEnd: number;
  totalRemainingW2Gross: number;
  w4GapInputs: W4GapInputs;
  /** True when there's enough W-2 data (saved companies, streams, or YTD) to compute a recommendation. */
  hasW2Data: boolean;
  countPlannedNonW2Reserves: boolean;
  setCountPlannedNonW2Reserves: (v: boolean) => void;
  projectedHouseholdGross: number;
  projectedFederalWithholding: number;
  annualTaxGap: number;
  annualTaxSurplus: number;
  /** Canonical annual allocation the W-4 gap is derived from. */
  allocation: ReturnType<typeof buildAllocationFromEstimate>;
  /** Source-specific funding plan. `w2.remainingNeed` === `remainingW4Gap`. */
  sourceFunding: SourceFundingPlan;
  /** Business/1099 remaining canonical responsibility (funded by reserves). */
  businessRemainingNeed: number;
  /** Display-only: remaining business gross × canonical bucket rate. */
  projectedPlannedFutureBusinessReserves: number;
  /** Per-employer recommendation net of that employer's current W-4 extra. */
  employerW4Recommendations: EmployerW4Recommendation<any>[];
  /** Canonical annual liability shown in Calculation details. */
  projectedTotalTax: number;
  /** Canonical reconciliation — the exact rows the card must render. */
  reconciliation: W4Reconciliation;
  /** Actual YTD W-2 federal + state withholding. */
  taxesAlreadyWithheld: number;
  actualTaxSavedOrPaid: number;
  estimatedPaymentsMade: number;
  /** Projected future W-2 withholding EXCLUDING current Step 4(c). */
  projectedFutureBaselineW2Withholding: number;
  /** Current Step 4(c) across all remaining paychecks (counted once). */
  currentExtraW4FutureWithholding: number;
  /** Business reserves credited toward the gap (0 when the toggle is off). */
  plannedFutureBusinessReservesCounted: number;
  /** Total future W-2 federal withholding required (Step-4(c)-invariant). */
  requiredFutureW2Withholding: number;
  /** True when the household has 1099/K-1/business income. */
  hasNonW2Income: boolean;
}


export function useW4Calculation(): W4CalculationResult {
  const { actualEstimate, currentPaceEstimate, forecastEstimate, forecastDebug, actualDebug, currentPaceDebug } = useTaxEstimate();
  const { data: settings } = useTaxSettings();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: transactions } = useTransactions();
  const { companies } = useCompanies();

  // The annual estimate selected by the user's withholding method. Single
  // source for BOTH the canonical allocation and every rate below.
  // The W-4 funds the REST OF THE YEAR, so the canonical allocation must come
  // from the SAME actual+planned forecast bundle as `selectedDebug` below.
  // Mixing bundles (allocation from current-pace, liability from forecast) made
  // the gap/targets go stale when planned 1099/K-1 income changed.
  const selectedEstimate =
    forecastEstimate ??
    ((settings?.withholdingMethod ?? "dynamic_planner") === "dynamic_planner"
      ? actualEstimate
      : (currentPaceEstimate ?? actualEstimate));

  // Canonical annual allocation: how much of the annual liability each source
  // owes. The W-4 gap below is derived from the W-2 slice of THIS, never from a
  // household residual.
  const allocation = useMemo(
    () => buildAllocationFromEstimate(selectedEstimate),
    [selectedEstimate],
  );

  // Display-only business reserve rate (used for the projected-reserve line).
  const businessReserveRate = getCanonicalBucketRatePct({
    estimate: selectedEstimate,
    taxSettings: settings,
    bucket: "business",
    incomeType: "1099",
  });

  const todayStr = new Date().toISOString().split("T")[0];

  // Whether the household has non-W-2 income (drives the business-reserve
  // toggle visibility on the card).
  const hasNonW2Income = useMemo(() => {
    const streamHasNonW2 = (streams || []).some((s) => {
      if (!s.is_active) return false;
      const ft = normalizeFilingType(s.company_type);
      return ft !== "w2" && ft !== "scorp_w2";
    });
    if (streamHasNonW2) return true;
    return (companies || []).some((c) => {
      const ft = normalizeFilingType(c.companyType);
      return ft !== "w2" && ft !== "scorp_w2";
    });
  }, [streams, companies]);


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

  const employerRows = useMemo(() => {
    const w2Streams = (streams || []).filter((s) => s.is_active && isW2Stream(s));
    const futureDatesByStream = new Map<string, Set<string>>();
    for (const p of allProjected) {
      if (p.isSkipped) continue;
      if (p.date <= todayStr) continue;
      if (p.matchStatus === "matched" || p.matchStatus === "converted") continue;
      if (p.type !== "paycheck") continue;
      if (!futureDatesByStream.has(p.streamId)) futureDatesByStream.set(p.streamId, new Set());
      futureDatesByStream.get(p.streamId)!.add(p.date);
    }
    const groups = groupW2StreamsByEmployer(w2Streams, futureDatesByStream);

    return groups.map((g) => {
      let det: { frequency: string | null; lastDate: string | null } | null = null;
      for (const sid of g.uniqueSourceIds) {
        const d = detectionBySourceId.get(sid);
        if (d && (d.frequency || d.lastDate)) { det = d; break; }
      }
      if (!det) det = detectionBySourceId.get(g.primaryStreamId) ?? null;

      let remainingPaychecks = 0;
      let remainingGross = 0;
      let expectedNormalWithholding = 0;
      const includedSet = new Set(g.includedStreamIds);
      const seenPaycheckDates = new Set<string>();
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
        // FEDERAL INCOME TAX ONLY. `taxesWithheld` is the canonical total
        // federal payroll tax (fed + SS + Medicare); crediting SS/Medicare
        // against the income-tax-only W-2 allocated responsibility would
        // understate the W-4 gap.
        expectedNormalWithholding += getFederalIncomeTaxWithheld({
          taxes_withheld: p.taxesWithheld,
          federal_withholding: p.federalWithholding,
          ss_withholding: p.ssWithholding,
          medicare_withholding: p.medicareWithholding,
        });
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

  const ytdFallbackRows = useMemo(() => {
    if (employerRows.length > 0) return [];
    return buildYtdFallbackEmployerRows(incomeEntries as any);
  }, [employerRows, incomeEntries]);

  const companyOnlyRows = useMemo(() => {
    const baseRows = employerRows.length > 0 ? employerRows : ytdFallbackRows;
    const existingKeys = new Set<string>();
    for (const r of baseRows) {
      const k = `emp:${normalizeEmployerName(r.company)}|w2`;
      existingKeys.add(k);
    }
    return buildCompanyOnlyEmployerRows(
      companies.map((c) => ({ name: c.name, companyType: c.companyType, payFrequency: c.payFrequency })),
      existingKeys,
    );
  }, [companies, employerRows, ytdFallbackRows]);

  const sourceRows = [
    ...(employerRows.length > 0 ? employerRows : ytdFallbackRows),
    ...companyOnlyRows,
  ];

  const TOGGLE_KEY = "w4.countPlannedNonW2Reserves";
  const [countPlannedNonW2Reserves, setCountPlannedNonW2Reserves] = useState<boolean>(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TOGGLE_KEY);
      if (raw === "false") setCountPlannedNonW2Reserves(false);
      else if (raw === "true") setCountPlannedNonW2Reserves(true);
    } catch { /* ignore */ }
  }, []);
  const handleToggleChange = (next: boolean) => {
    setCountPlannedNonW2Reserves(next);
    try { localStorage.setItem(TOGGLE_KEY, next ? "true" : "false"); } catch { /* ignore */ }
  };

  // Display-only: what the business source is expected to reserve out of its
  // remaining gross at the canonical bucket rate. NOT used for the W-4 gap.
  const futureBusinessGross = Math.max(
    0,
    Number(forecastDebug?.grossBusinessIncome ?? 0) - Number(actualDebug?.grossBusinessIncome ?? 0),
  );
  const projectedPlannedFutureBusinessReserves =
    futureBusinessGross * (businessReserveRate / 100);


  const companyByEmployerKey = useMemo(() => {
    const map = new Map<string, {
      id: string;
      payFrequency: string | null;
      remainingOverride: number | null;
      projectedAnnualGross: number | null;
      expectedFederalWithholdingPerPaycheck: number | null;
      currentExtraW4Withholding: number;
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
        expectedFederalWithholdingPerPaycheck: c.expectedFederalWithholdingPerPaycheck ?? null,
        currentExtraW4Withholding: resolveCurrentExtraW4(c.currentExtraW4Withholding),
      };
      if (
        !prev ||
        (!prev.payFrequency && next.payFrequency) ||
        (prev.projectedAnnualGross == null && next.projectedAnnualGross != null) ||
        (prev.expectedFederalWithholdingPerPaycheck == null && next.expectedFederalWithholdingPerPaycheck != null)
      ) {
        map.set(key, next);
      }
    }
    return map;
  }, [companies]);

  const ytdByEmployerKey = useMemo(() => {
    const year = new Date().getFullYear().toString();
    const map = new Map<
      string,
      { gross: number; withheld: number; fedIncomeTax: number; paycheckCount: number }
    >();
    for (const e of incomeEntries || []) {
      if (typeof e.income_type !== "string" || !isW2FilingType(e.income_type)) continue;
      const d = (e as any).income_date as string | undefined;
      if (!d || !d.startsWith(year)) continue;
      const key = `emp:${normalizeEmployerName((e as any).company)}|w2`;
      const prev =
        map.get(key) || { gross: 0, withheld: 0, fedIncomeTax: 0, paycheckCount: 0 };
      prev.gross += Number((e as any).paycheck_amount) || 0;
      prev.withheld += Number((e as any).taxes_withheld) || 0;
      // Display-only "recent actual" context (federal income tax only).
      if (!isYtdCatchupEntry(e as any)) {
        prev.fedIncomeTax += getFederalIncomeTaxWithheld(e as any);
        prev.paycheckCount += 1;
      }
      map.set(key, prev);
    }
    return map;
  }, [incomeEntries]);

  const effectiveRows = useMemo(() => {
    return sourceRows.map((r) => {
      const lookupKey = `emp:${normalizeEmployerName(r.company)}|w2`;
      const settings = companyByEmployerKey.get(r.streamId) || companyByEmployerKey.get(lookupKey);
      const autoFrequency = r.detectedFrequency ?? r.payFrequency;
      const frequency = settings?.payFrequency || autoFrequency;
      const detectedPaychecks = r.remainingPaychecks;
      const isYtdFallback = Boolean((r as any).__isYtdFallback);

      // Recurring W-2 planner stream (multiple scheduled future paychecks) is
      // the primary source; saved Settings estimates are fallbacks only.
      const hasRecurringPlannerStream =
        !isYtdFallback && detectedPaychecks >= 2 && r.remainingGross > 0;

      let autoPaychecks: number;
      if (hasRecurringPlannerStream) autoPaychecks = detectedPaychecks;
      else if (r.lastPaycheckDate) autoPaychecks = paychecksFromLastDate(frequency, r.lastPaycheckDate);
      else if (detectedPaychecks > 0 && !settings?.payFrequency) autoPaychecks = detectedPaychecks;
      else autoPaychecks = defaultRemainingPaychecks(frequency);

      const remainingPaychecks = settings?.remainingOverride != null
        ? Math.max(0, Math.floor(settings.remainingOverride))
        : autoPaychecks;

      const savedAnnualGross = hasRecurringPlannerStream ? null : (settings?.projectedAnnualGross ?? null);
      const savedFedPerPaycheck = hasRecurringPlannerStream ? null : (settings?.expectedFederalWithholdingPerPaycheck ?? null);

      const ytd =
        ytdByEmployerKey.get(lookupKey) || {
          gross: 0,
          withheld: 0,
          fedIncomeTax: 0,
          paycheckCount: 0,
        };

      let remainingGross: number;
      let expectedNormalWithholding: number;

      if (savedAnnualGross != null) remainingGross = Math.max(0, savedAnnualGross - ytd.gross);
      else if (isYtdFallback) remainingGross = ((r as any).__ytdAvgGross || 0) * remainingPaychecks;
      else {
        const ratio = detectedPaychecks > 0 ? remainingPaychecks / detectedPaychecks : 0;
        remainingGross = detectedPaychecks > 0 ? r.remainingGross * ratio : r.remainingGross;
      }

      // Employer-specific extra W-4 withholding already on file. This is NOT
      // folded into the baseline projection used to size the gap — doing so
      // made the user's own setting shrink the target it was measured against
      // (a moving target / feedback loop). The baseline stays the employer's
      // normal payroll withholding; the current extra is tracked separately and
      // subtracted ONCE at the end to show the still-uncovered shortfall.
      const currentExtraW4PerPaycheck = resolveCurrentExtraW4(settings?.currentExtraW4Withholding);

      let rawFutureFederalWithholding: number;
      if (savedFedPerPaycheck != null) rawFutureFederalWithholding = savedFedPerPaycheck * remainingPaychecks;
      else if (isYtdFallback) rawFutureFederalWithholding = ((r as any).__ytdAvgWithheld || 0) * remainingPaychecks;
      else rawFutureFederalWithholding = r.expectedNormalWithholding;

      // The stored per-paycheck federal withholding (planner stream, saved
      // company setting, or YTD average) is the employer's ACTUAL current
      // withholding — it already contains any Step 4(c) extra on file. The
      // baseline must be pre-4(c), otherwise the same extra is counted twice
      // (once here, once as `currentExtraW4FutureWithholding`).
      expectedNormalWithholding = Math.max(
        0,
        rawFutureFederalWithholding -
          currentExtraW4PerPaycheck * Math.max(0, remainingPaychecks),
      );


      const hasSavedFutureSettings =
        savedAnnualGross != null ||
        (savedFedPerPaycheck != null && !!settings?.payFrequency);
      const hasStreamProjection = !isYtdFallback && detectedPaychecks > 0;

      return {
        ...r,
        payFrequency: frequency,
        remainingPaychecks,
        remainingGross,
        expectedNormalWithholding,
        currentExtraW4PerPaycheck,
        companyId: settings?.id ?? null,
        missingSettings: !settings?.payFrequency,
        isYtdFallback,
        usedSavedSettings: savedAnnualGross != null || savedFedPerPaycheck != null,
        hasYtdData: (Number((r as any).__ytdGrossTotal) || ytd.gross || 0) > 0
          || (Number((r as any).__ytdWithheldTotal) || ytd.withheld || 0) > 0
          || detectedPaychecks > 0,
        hasFutureProjection:
          hasSavedFutureSettings || hasStreamProjection || remainingGross > 0,
        hasStreamProjection,
        settingsOnlyFuture: hasSavedFutureSettings && !hasStreamProjection,
        hasRecurringPlannerStream,
        // Which existing source drives this employer's future paycheck data.
        projectionSource: (hasRecurringPlannerStream
          ? "planner"
          : hasSavedFutureSettings
            ? "settings"
            : hasStreamProjection
              ? "planner"
              : "history") as "planner" | "settings" | "history",
        ytdGrossTotal: Number((r as any).__ytdGrossTotal) || ytd.gross || 0,
        ytdWithheldTotal: Number((r as any).__ytdWithheldTotal) || ytd.withheld || 0,
        // Override-visibility disclosure (display only — no math impact).
        savedFedPerPaycheckOverride: savedFedPerPaycheck,
        savedAnnualGrossOverride: savedAnnualGross,
        recentActualFedPerPaycheck:
          ytd.paycheckCount > 0 ? ytd.fedIncomeTax / ytd.paycheckCount : null,
        recentActualGrossPerPaycheck:
          ytd.paycheckCount > 0 && ytd.gross > 0 ? ytd.gross / ytd.paycheckCount : null,
      };
    });
  }, [sourceRows, companyByEmployerKey, ytdByEmployerKey]);

  const totalRemainingW2Gross = effectiveRows.reduce((s, r) => s + r.remainingGross, 0);

  // The debug bundle MUST come from the SAME estimate the user's withholding
  // method selects (and that Tax Overview shows), otherwise planned income
  // changes never move the W-4 recommendation.
  // The W-4 funds the REST OF THE YEAR, so it must consume the actual+planned
  // forecast bundle (the same one the Income Planner uses) — otherwise adding a
  // recurring 1099/K-1 planned stream never moves the W-4 gap or targets.
  const selectedDebug =
    forecastDebug ??
    ((settings?.withholdingMethod ?? "dynamic_planner") === "dynamic_planner"
      ? actualDebug
      : (currentPaceDebug ?? actualDebug));

  const projectedTotalTax = Number(selectedDebug?.totalEstimatedTax ?? 0);
  const taxesAlreadyWithheld =
    Number(selectedDebug?.actualFederalWithheld ?? 0) +
    Number(selectedDebug?.actualStateWithheld ?? 0);
  const actualTaxSavedOrPaid = Number(selectedDebug?.taxSavingsSetAside ?? 0);
  const estPaymentsAlreadyMade = Number(selectedDebug?.estimatedPaymentsMade ?? 0);
  // Baseline future W-2 withholding — payroll only, excludes any extra the user
  // already has on their W-4 (that is applied once, below).
  const expectedFutureNormalW2Withholding = effectiveRows.reduce(
    (s, r) => s + (Number(r.expectedNormalWithholding) || 0),
    0,
  );
  const currentExtraW4FutureWithholding = effectiveRows.reduce(
    (s, r) =>
      s +
      resolveCurrentExtraW4((r as any).currentExtraW4PerPaycheck) *
        Math.max(0, Number(r.remainingPaychecks) || 0),
    0,
  );

  // ── SOURCE-SPECIFIC funding (the W-4 fix) ───────────────────────────────
  // The W-4 ask must close ONLY the W-2 source's deficit:
  //   W-2 allocated responsibility
  //     − W-2 actual income-tax withholding (never FICA)
  //     − expected baseline future W-2 withholding
  //     − W-2's share of household estimated payments / savings
  // Uncovered BUSINESS responsibility stays with the business source; it can
  // no longer spill into W-2 withholding as a household residual.
  const sourceFunding: SourceFundingPlan = buildSourceFundingPlan({
    allocation,
    w2ActualWithheldYtd: taxesAlreadyWithheld,
    w2ExpectedFutureBaselineWithholding: expectedFutureNormalW2Withholding,
    estimatedPaymentsMade: estPaymentsAlreadyMade,
    householdSavingsSetAside: actualTaxSavedOrPaid,
  });

  // Business/1099 funds its own canonical allocated responsibility minus its
  // own coverage — not `future gross × rate`.
  const businessRemainingNeed = sourceFunding.nonW2.remainingNeed;

  // ONLY genuinely future Planner business income can produce a reserve credit.
  // Recommendations attached to already-earned YTD 1099/K-1 income are guidance,
  // not money, and never reduce the W-4 gap (audit finding #2).
  const eligibleFutureBusinessReserves = computeEligibleFutureBusinessReserves({
    enabled: countPlannedNonW2Reserves,
    futureBusinessGross,
    reserveRatePct: businessReserveRate,
    nonW2RemainingNeed: businessRemainingNeed,
  });
  const plannedFutureBusinessReservesCounted = eligibleFutureBusinessReserves;

  // ── Canonical reconciliation (single formula, no plug values) ────────────
  const reconciliation = buildW4Reconciliation({
    projectedTotalTax,
    actualW2WithholdingYtd: taxesAlreadyWithheld,
    futureBaselineW2Withholding: expectedFutureNormalW2Withholding,
    futureCurrentStep4c: currentExtraW4FutureWithholding,
    actualSavedReserves: actualTaxSavedOrPaid,
    estimatedPaymentsMade: estPaymentsAlreadyMade,
    eligibleFutureBusinessReserves,
  });

  const signedAnnualGap = reconciliation.signedRemainingGap;
  const remainingW4Gap = reconciliation.remainingGap;

  // Kept for the card's reconciliation display and existing unit tests. The
  // business term mirrors the toggle so the displayed lines reconcile with the
  // gap in BOTH states.
  const w4GapInputs: W4GapInputs = {
    projectedAnnualFederalTax: projectedTotalTax,
    actualWithheldYtd: taxesAlreadyWithheld,
    projectedFutureFederalW2Withholding:
      expectedFutureNormalW2Withholding + currentExtraW4FutureWithholding,
    actualTaxSavedOrPaid,
    estimatedPaymentsMade: estPaymentsAlreadyMade,
    plannedFutureNonW2ReservesCounted: plannedFutureBusinessReservesCounted,
  };


  const projectedHouseholdGross = Number(selectedDebug?.totalGrossIncome ?? 0);
  const projectedFederalWithholding =
    Number(selectedDebug?.actualFederalWithheld ?? 0) +
    expectedFutureNormalW2Withholding +
    currentExtraW4FutureWithholding;
  const annualTaxGap = Math.max(0, signedAnnualGap);
  const annualTaxSurplus = Math.max(0, -signedAnnualGap);


  // Total federal income tax the W-2 source must still withhold this year.
  // Step-4(c)-invariant by construction (see w4Reconciliation), so employer
  // targets cannot be re-weighted by what any employer currently has on file.
  const requiredFutureW2Withholding = reconciliation.requiredFutureW2Withholding;


  // Each employer takes a gross-weighted share of the shared requirement and
  // subtracts only ITS OWN baseline payroll withholding → stable targets.
  const allocations = useMemo(
    () => {
      const stable = allocateStableW4Targets(
        effectiveRows as any[],
        requiredFutureW2Withholding,
      );
      return effectiveRows
        .filter((r: any) => Math.max(0, Number(r.remainingPaychecks) || 0) > 0)
        .map((r: any) => {
          const t = stable.find((s) => s.streamId === r.streamId);
          const step4cPerPaycheck = t?.step4cPerPaycheck ?? 0;
          return {
            ...r,
            exactPerPaycheck: t?.exactPerPaycheck ?? 0,
            exactEmployerGap:
              (t?.exactPerPaycheck ?? 0) * Math.max(0, Number(r.remainingPaychecks) || 0),
            step4cPerPaycheck,
            employerGap: step4cPerPaycheck * Math.max(0, Number(r.remainingPaychecks) || 0),
          };
        }) as Allocation[];
    },
    [effectiveRows, requiredFutureW2Withholding],
  );

  const totalExtraThroughYearEnd = allocations.reduce(
    (s, a) => s + a.step4cPerPaycheck * a.remainingPaychecks,
    0,
  );

  const employerW4Recommendations = buildEmployerW4Recommendations(
    effectiveRows as any[],
    allocations,
  );


  return {
    effectiveRows,
    allocations,
    employerW4Recommendations,
    signedAnnualGap,
    remainingW4Gap,
    totalExtraThroughYearEnd,
    totalRemainingW2Gross,
    w4GapInputs,
    hasW2Data: effectiveRows.length > 0,
    countPlannedNonW2Reserves,
    setCountPlannedNonW2Reserves: handleToggleChange,
    projectedHouseholdGross,
    projectedFederalWithholding,
    annualTaxGap,
    annualTaxSurplus,
    allocation,
    sourceFunding,
    businessRemainingNeed,
    projectedPlannedFutureBusinessReserves,
    // ── Canonical reconciliation values (single source for the card's
    // "Calculation details" rows — the card must never recompute these). ──
    projectedTotalTax,
    reconciliation,
    taxesAlreadyWithheld,
    actualTaxSavedOrPaid,
    estimatedPaymentsMade: estPaymentsAlreadyMade,
    projectedFutureBaselineW2Withholding: expectedFutureNormalW2Withholding,
    currentExtraW4FutureWithholding,
    plannedFutureBusinessReservesCounted,
    requiredFutureW2Withholding,
    hasNonW2Income,
  };
}
