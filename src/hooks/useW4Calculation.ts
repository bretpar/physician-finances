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
import { getSavingsRateForIncomeBucket } from "@/lib/savingsRateSelection";
import { normalizeFilingType, isW2FilingType } from "@/lib/filingTypes";
import {
  buildYtdFallbackEmployerRows,
  buildCompanyOnlyEmployerRows,
  computeAllocations,
  computeRemainingW4Gap,
  computeSignedW4Gap,
  defaultRemainingPaychecks,
  detectFrequencyFromDates,
  groupW2StreamsByEmployer,
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
}

export function useW4Calculation(): W4CalculationResult {
  const { actualEstimate, currentPaceEstimate, forecastEstimate, forecastDebug, actualDebug } = useTaxEstimate();
  const { data: settings } = useTaxSettings();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: transactions } = useTransactions();
  const { companies } = useCompanies();

  const businessRateSel = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "1099",
    taxSettings: settings,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
    includeSETaxInRecommendation: true,
  });
  const businessReserveRate = businessRateSel.rate;

  const todayStr = new Date().toISOString().split("T")[0];

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

  const futureBusinessGross = Math.max(
    0,
    Number(forecastDebug?.grossBusinessIncome ?? 0) - Number(actualDebug?.grossBusinessIncome ?? 0),
  );
  const projectedPlannedFutureBusinessReserves =
    futureBusinessGross * (businessReserveRate / 100);
  const plannedFutureBusinessReservesCounted = countPlannedNonW2Reserves
    ? projectedPlannedFutureBusinessReserves
    : 0;

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
        expectedFederalWithholdingPerPaycheck: c.expectedFederalWithholdingPerPaycheck ?? null,
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

  const effectiveRows = useMemo(() => {
    return sourceRows.map((r) => {
      const lookupKey = `emp:${normalizeEmployerName(r.company)}|w2`;
      const settings = companyByEmployerKey.get(r.streamId) || companyByEmployerKey.get(lookupKey);
      const autoFrequency = r.detectedFrequency ?? r.payFrequency;
      const frequency = settings?.payFrequency || autoFrequency;
      const detectedPaychecks = r.remainingPaychecks;
      const isYtdFallback = Boolean((r as any).__isYtdFallback);

      let autoPaychecks: number;
      if (r.lastPaycheckDate) autoPaychecks = paychecksFromLastDate(frequency, r.lastPaycheckDate);
      else if (detectedPaychecks > 0 && !settings?.payFrequency) autoPaychecks = detectedPaychecks;
      else autoPaychecks = defaultRemainingPaychecks(frequency);

      const remainingPaychecks = settings?.remainingOverride != null
        ? Math.max(0, Math.floor(settings.remainingOverride))
        : autoPaychecks;

      const savedAnnualGross = settings?.projectedAnnualGross ?? null;
      const savedFedPerPaycheck = settings?.expectedFederalWithholdingPerPaycheck ?? null;
      const ytd = ytdByEmployerKey.get(lookupKey) || { gross: 0, withheld: 0 };

      let remainingGross: number;
      let expectedNormalWithholding: number;

      if (savedAnnualGross != null) remainingGross = Math.max(0, savedAnnualGross - ytd.gross);
      else if (isYtdFallback) remainingGross = ((r as any).__ytdAvgGross || 0) * remainingPaychecks;
      else {
        const ratio = detectedPaychecks > 0 ? remainingPaychecks / detectedPaychecks : 0;
        remainingGross = detectedPaychecks > 0 ? r.remainingGross * ratio : r.remainingGross;
      }

      if (savedFedPerPaycheck != null) expectedNormalWithholding = savedFedPerPaycheck * remainingPaychecks;
      else if (isYtdFallback) expectedNormalWithholding = ((r as any).__ytdAvgWithheld || 0) * remainingPaychecks;
      else expectedNormalWithholding = r.expectedNormalWithholding;

      return {
        ...r,
        payFrequency: frequency,
        remainingPaychecks,
        remainingGross,
        expectedNormalWithholding,
        missingSettings: !settings?.payFrequency,
        isYtdFallback,
        usedSavedSettings: savedAnnualGross != null || savedFedPerPaycheck != null,
        hasYtdData: (Number((r as any).__ytdGrossTotal) || ytd.gross || 0) > 0
          || (Number((r as any).__ytdWithheldTotal) || ytd.withheld || 0) > 0
          || detectedPaychecks > 0,
        hasFutureProjection:
          savedAnnualGross != null
          || (savedFedPerPaycheck != null && !!settings?.payFrequency)
          || (!isYtdFallback && detectedPaychecks > 0)
          || remainingGross > 0,
        ytdGrossTotal: Number((r as any).__ytdGrossTotal) || ytd.gross || 0,
        ytdWithheldTotal: Number((r as any).__ytdWithheldTotal) || ytd.withheld || 0,
      };
    });
  }, [sourceRows, companyByEmployerKey, ytdByEmployerKey]);

  const totalRemainingW2Gross = effectiveRows.reduce((s, r) => s + r.remainingGross, 0);

  const projectedTotalTax = Number(forecastDebug?.totalEstimatedTax ?? 0);
  const taxesAlreadyWithheld =
    Number(forecastDebug?.actualFederalWithheld ?? 0) +
    Number(forecastDebug?.actualStateWithheld ?? 0);
  const actualTaxSavedOrPaid = Number(forecastDebug?.taxSavingsSetAside ?? 0);
  const estPaymentsAlreadyMade = Number(forecastDebug?.estimatedPaymentsMade ?? 0);
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
  const signedAnnualGap = computeSignedW4Gap(w4GapInputs);
  const remainingW4Gap = computeRemainingW4Gap(w4GapInputs);

  const projectedHouseholdGross = Number(forecastDebug?.totalGrossIncome ?? 0);
  const projectedFederalWithholding =
    Number(forecastDebug?.actualFederalWithheld ?? 0) + expectedFutureNormalW2Withholding;
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

  return {
    effectiveRows,
    allocations,
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
  };
}
