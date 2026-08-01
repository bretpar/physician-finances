/**
 * Aggregates existing hook data into the Insights list.
 *
 * READ ONLY. No new calculations — quarter numbers come from
 * `buildQuarterRecommendation` via the canonical `useQuarterRecommendationInput`,
 * tax liability from the canonical tax engine, and deduction coverage from the
 * same hooks the Tax Savings page uses.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useRetirementContributions } from "@/hooks/useRetirementContributions";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useMileageYTD } from "@/hooks/useMileage";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useQuarterRecommendationInput } from "@/hooks/useQuarterRecommendationInput";
import { buildQuarterRecommendation, getActivePaymentTarget } from "@/lib/quarterRecommendation";
import { computeQuarterPace } from "@/lib/quarterPaceStatus";
import { deriveUserTypeFromIncomeStreams } from "@/lib/entitlements";
import { buildInsights, INCOME_CHANGE_THRESHOLD, type Insight } from "@/lib/insights";

const baselineKey = (userId?: string) => `paycheckmd:insights:incomeBaseline:${userId ?? "anon"}`;
/** Refresh a stale baseline so an old comparison can't linger forever. */
const BASELINE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Tracks the last observed projected annual income so a meaningful swing can be
 * surfaced as an insight. Presentation-only state (localStorage), never written
 * to the backend.
 */
function useIncomeChange(projectedAnnualIncome: number, isReady: boolean) {
  const { user } = useAuth();
  const [change, setChange] = useState(0);

  useEffect(() => {
    if (!isReady || !(projectedAnnualIncome > 0)) return;
    const key = baselineKey(user?.id);
    let baseline: { value: number; ts: number } | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.value === "number" && typeof parsed?.ts === "number") baseline = parsed;
      }
    } catch {
      baseline = null;
    }

    const write = () => {
      try {
        localStorage.setItem(key, JSON.stringify({ value: projectedAnnualIncome, ts: Date.now() }));
      } catch {
        /* storage unavailable — insight simply won't surface */
      }
    };

    if (!baseline) {
      write();
      setChange(0);
      return;
    }

    const delta = projectedAnnualIncome - baseline.value;
    if (Math.abs(delta) < INCOME_CHANGE_THRESHOLD || Date.now() - baseline.ts > BASELINE_TTL_MS) {
      // Nothing meaningful (or the baseline aged out) — re-anchor.
      write();
      setChange(Math.abs(delta) < INCOME_CHANGE_THRESHOLD ? 0 : 0);
      return;
    }
    setChange(delta);
  }, [isReady, projectedAnnualIncome, user?.id]);

  return change;
}

/** Executive-summary inputs for the Financial Assistant (display only). */
export interface AssistantSummary {
  projectedAnnualIncome: number;
  annualTaxLiability: number;
  paceHeadline: string;
  paceDetail: string;
  paceTone: "success" | "info" | "warning" | "neutral";
  quarterLabel: string;
  deadlineLabel: string;
  daysUntilDue: number;
  showQuarterly: boolean;
  recommendation: FinancialAssistantRecommendation;
}

export function useInsights(): { insights: Insight[]; isReady: boolean; assistant: AssistantSummary } {
  const currentYear = new Date().getFullYear();
  const { data: taxSettings, isLoading: taxSettingsLoading } = useTaxSettings();
  const { data: retirement, isLoading: retirementLoading } = useRetirementContributions();
  const { data: homeOffice, isLoading: homeOfficeLoading } = useHomeOfficeDeductions(currentYear);
  const { data: ytdMileage = [], isLoading: mileageLoading } = useMileageYTD(currentYear);
  const { actualEstimate, currentPaceEstimate, forecastEstimate, actualDebug, forecastDebug, taxMode, isLoading: estLoading } =
    useTaxEstimate();

  const sharedQrInput = useQuarterRecommendationInput();
  const now = useMemo(() => new Date(), []);
  const quarter = useMemo(
    () =>
      buildQuarterRecommendation({
        ...sharedQrInput,
        ...getActivePaymentTarget(now),
        now,
      }),
    [sharedQrInput, now],
  );

  const isW2OnlyUser = deriveUserTypeFromIncomeStreams(taxSettings?.householdIncomeStreams) === "W2_ONLY";
  // Shared pace status — identical calculation to the dashboard banner and
  // the Tax Progress card, so statuses can never contradict each other.
  const pace = useMemo(
    () =>
      computeQuarterPace({
        quarterTarget: quarter.quarterTarget,
        progressAmount: quarter.progressAmount,
        start: quarter.start,
        end: quarter.end,
        daysUntilDue: quarter.daysUntilDue,
        quarterLabel: quarter.quarterLabel,
        deadlineLabel: quarter.deadlineLabel,
        showQuarterly: !isW2OnlyUser,
        now,
      }),
    [quarter, isW2OnlyUser, now],
  );

  const method = taxSettings?.withholdingMethod ?? "dynamic_planner";
  const baseEstimate =
    method === "dynamic_planner" ? (forecastEstimate ?? actualEstimate) : (currentPaceEstimate ?? actualEstimate);
  const annualTaxLiability = Math.max(0, Number(baseEstimate?.totalTaxLiability || 0));
  const activeDebug = taxMode === "forecast" ? forecastDebug : actualDebug;
  const projectedAnnualIncome = Math.max(0, Number(activeDebug?.totalGrossIncome || 0));

  const isReady =
    !taxSettingsLoading && !retirementLoading && !homeOfficeLoading && !mileageLoading && !estLoading && !sharedQrInput.isLoading;

  const incomeChange = useIncomeChange(projectedAnnualIncome, isReady);

  const isW2Only = deriveUserTypeFromIncomeStreams(taxSettings?.householdIncomeStreams) === "W2_ONLY";

  const insights = useMemo(
    () =>
      buildInsights({
        isReady,
        projectedAnnualIncome,
        annualTaxLiability,
        savingsCoverageRatio: pace.paceRatio,
        stillNeedToSave: pace.shortfallToDate,
        quarterLabel: quarter.quarterLabel,
        deadlineLabel: quarter.deadlineLabel,
        daysUntilDue: quarter.daysUntilDue,
        showQuarterly: !isW2Only,
        hasRetirement: (retirement?.length || 0) > 0,
        hasHsa: !!taxSettings?.hsaEnabled,
        hasHomeOffice: (homeOffice?.length || 0) > 0,
        hasMileage: (ytdMileage?.length || 0) > 0,
        hasStudentLoanInterest: Number(taxSettings?.studentLoanInterestAnnual || 0) > 0,
        incomeChange,
      }),
    [
      isReady,
      projectedAnnualIncome,
      annualTaxLiability,
      quarter,
      pace,
      isW2Only,
      retirement,
      taxSettings?.hsaEnabled,
      taxSettings?.studentLoanInterestAnnual,
      homeOffice,
      ytdMileage,
      incomeChange,
    ],
  );

  const assistant = useMemo<AssistantSummary>(
    () => ({
      projectedAnnualIncome,
      annualTaxLiability,
      paceHeadline: pace.headline,
      paceDetail: pace.detail,
      paceTone: pace.tone,
      quarterLabel: quarter.quarterLabel,
      deadlineLabel: quarter.deadlineLabel,
      daysUntilDue: quarter.daysUntilDue,
      showQuarterly: !isW2Only,
      recommendation: selectFinancialAssistantRecommendation({
        isReady,
        projectedAnnualIncome,
        annualTaxLiability,
        savingsCoverageRatio: pace.paceRatio,
        quarterLabel: quarter.quarterLabel,
        deadlineLabel: quarter.deadlineLabel,
        daysUntilDue: quarter.daysUntilDue,
        showQuarterly: !isW2Only,
        hasRetirement: (retirement?.length || 0) > 0,
        hasHsa: !!taxSettings?.hsaEnabled,
        hasHomeOffice: (homeOffice?.length || 0) > 0,
        hasMileage: (ytdMileage?.length || 0) > 0,
      }),
    }),
    [
      isReady,
      projectedAnnualIncome,
      annualTaxLiability,
      pace,
      quarter,
      isW2Only,
      retirement,
      taxSettings?.hsaEnabled,
      homeOffice,
      ytdMileage,
    ],
  );

  return { insights, isReady, assistant };
}
