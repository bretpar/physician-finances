import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, PiggyBank, ArrowRight, Info } from "lucide-react";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useRetirementContributions } from "@/hooks/useRetirementContributions";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useMileageYTD } from "@/hooks/useMileage";
import { selectFinancialAssistantRecommendation } from "@/lib/financialAssistantRecommendation";
import type { QuarterPaceResult } from "@/lib/quarterPaceStatus";

/**
 * Compact focus banner. DISPLAY ONLY — reuses the existing recommendation
 * ladder and the shared `computeQuarterPace` status, performs no tax math and
 * makes no writes.
 *
 * Quarterly messaging always compares against the amount recommended AS OF
 * TODAY (`pace`), never the full quarterly target, so a user mid-quarter who
 * is accumulating normally sees a green/yellow status instead of a red alarm.
 */
export interface TodaysFocusBannerProps {
  projectedAnnualIncome: number;
  annualTaxLiability: number;
  /** Shared pace status from `computeQuarterPace`. */
  pace: QuarterPaceResult;
  quarterLabel: string;
  deadlineLabel: string;
  daysUntilDue: number;
  showQuarterly?: boolean;
}

export default function TodaysFocusBanner({
  projectedAnnualIncome,
  annualTaxLiability,
  pace,
  quarterLabel,
  deadlineLabel,
  daysUntilDue,
  showQuarterly = true,
}: TodaysFocusBannerProps) {
  const currentYear = new Date().getFullYear();
  const { data: taxSettings, isLoading: taxSettingsLoading } = useTaxSettings();
  const { data: retirement, isLoading: retirementLoading } = useRetirementContributions();
  const { data: homeOffice, isLoading: homeOfficeLoading } = useHomeOfficeDeductions(currentYear);
  const { data: ytdMileage = [], isLoading: mileageLoading } = useMileageYTD(currentYear);

  const isReady = !taxSettingsLoading && !retirementLoading && !homeOfficeLoading && !mileageLoading;

  const rec = useMemo(
    () =>
      selectFinancialAssistantRecommendation({
        isReady,
        projectedAnnualIncome,
        annualTaxLiability,
        // Pace ratio — measured against today's recommendation.
        savingsCoverageRatio: pace.paceRatio,
        quarterLabel,
        deadlineLabel,
        daysUntilDue,
        showQuarterly,
        hasRetirement: (retirement?.length || 0) > 0,
        hasHsa: !!taxSettings?.hsaEnabled,
        hasHomeOffice: (homeOffice?.length || 0) > 0,
        hasMileage: (ytdMileage?.length || 0) > 0,
      }),
    [
      isReady,
      projectedAnnualIncome,
      annualTaxLiability,
      pace.paceRatio,
      quarterLabel,
      deadlineLabel,
      daysUntilDue,
      showQuarterly,
      retirement,
      taxSettings?.hsaEnabled,
      homeOffice,
      ytdMileage,
    ]
  );

  const quarterlyIds = new Set([
    "quarterly-overdue",
    "quarterly-due-soon",
    "quarterly-shortfall",
    "quarterly-slightly-behind",
  ]);

  type Copy = { text: string; detail?: string; cta?: string; to?: string; tone: "ok" | "warn" | "info" | "idea" };

  const COPY: Record<string, Copy> = {
    loading: { text: "Pulling together your latest numbers…", tone: "ok" },
    "add-income": {
      text: "Add your expected paychecks so we can project your year.",
      cta: "Review Income",
      to: "/projected-income",
      tone: "idea",
    },
    retirement: {
      text: "Increasing your retirement contributions could lower your taxes.",
      cta: "Review Retirement",
      to: "/deductions",
      tone: "idea",
    },
    hsa: {
      text: "Funding an HSA with pre-tax dollars could lower your taxes.",
      cta: "Review Tax Savings",
      to: "/deductions",
      tone: "idea",
    },
    "home-office": {
      text: "Claiming a home office deduction could lower your taxes.",
      cta: "Review Tax Savings",
      to: "/deductions",
      tone: "idea",
    },
    mileage: {
      text: "Logging your business mileage could lower your taxes.",
      cta: "Review Tax Savings",
      to: "/deductions",
      tone: "idea",
    },
    "all-set": { text: "You're on track with your tax savings.", tone: "ok" },
  };

  // Quarterly statuses are rendered straight from the shared pace result so
  // the banner, Tax Progress card and insights can never disagree.
  const copy: Copy = quarterlyIds.has(rec.id)
    ? {
        text: pace.headline,
        detail: pace.detail,
        cta: "Review Taxes",
        to: "/taxes",
        tone: pace.tone === "warning" ? "warn" : pace.tone === "info" ? "info" : "ok",
      }
    : rec.id === "all-set" && showQuarterly && (pace.status === "on_track" || pace.status === "ahead")
      ? { text: pace.headline, detail: pace.detail, tone: "ok" }
      : COPY[rec.id] ?? COPY["all-set"];

  const Icon =
    copy.tone === "warn"
      ? AlertTriangle
      : copy.tone === "info"
        ? Info
        : copy.tone === "idea"
          ? PiggyBank
          : CheckCircle2;
  const iconClass =
    copy.tone === "warn"
      ? "text-destructive"
      : copy.tone === "info"
        ? "text-warning"
        : copy.tone === "idea"
          ? "text-primary"
          : "text-success";
  const ringClass =
    copy.tone === "warn"
      ? "border-destructive/40 bg-destructive/[0.04]"
      : copy.tone === "info"
        ? "border-warning/40 bg-warning/[0.04]"
        : copy.tone === "ok"
          ? "border-success/40 bg-success/[0.04]"
          : "border-border bg-card";

  return (
    <section
      data-testid="todays-focus"
      data-status={copy.tone}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-sm ${ringClass}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-card-foreground">{copy.text}</p>
        {copy.detail && (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{copy.detail}</p>
        )}
      </div>
      {copy.cta && copy.to && (
        <Link
          to={copy.to}
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {copy.cta}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
