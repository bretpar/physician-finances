import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, PiggyBank, ArrowRight } from "lucide-react";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useRetirementContributions } from "@/hooks/useRetirementContributions";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useMileageYTD } from "@/hooks/useMileage";
import { selectFinancialAssistantRecommendation } from "@/lib/financialAssistantRecommendation";

/**
 * Compact one-sentence focus banner. DISPLAY ONLY — reuses the existing
 * recommendation ladder, performs no tax math and makes no writes.
 */
export interface TodaysFocusBannerProps {
  projectedAnnualIncome: number;
  annualTaxLiability: number;
  savingsCoverageRatio: number;
  /** Dollars still to set aside for the active quarter (already calculated). */
  stillNeedToSave?: number;
  quarterLabel: string;
  deadlineLabel: string;
  daysUntilDue: number;
  showQuarterly?: boolean;
}

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

export default function TodaysFocusBanner({
  projectedAnnualIncome,
  annualTaxLiability,
  savingsCoverageRatio,
  stillNeedToSave = 0,
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
        savingsCoverageRatio,
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
      savingsCoverageRatio,
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

  const behind = stillNeedToSave > 0 ? ` ${usd(stillNeedToSave)}` : "";

  const COPY: Record<string, { text: string; cta?: string; to?: string; tone: "ok" | "warn" | "idea" }> = {
    loading: { text: "Pulling together your latest numbers…", tone: "ok" },
    "add-income": {
      text: "Add your expected paychecks so we can project your year.",
      cta: "Review Income",
      to: "/projected-income",
      tone: "idea",
    },
    "quarterly-overdue": {
      text: `Your ${quarterLabel} estimated payment deadline has passed.`,
      cta: "Review Taxes",
      to: "/taxes",
      tone: "warn",
    },
    "quarterly-due-soon": {
      text: `You're about${behind || " short"} behind today's recommended tax savings, due ${deadlineLabel}.`,
      cta: "Review Taxes",
      to: "/taxes",
      tone: "warn",
    },
    "quarterly-shortfall": {
      text: `You're about${behind || " short"} behind today's recommended tax savings.`,
      cta: "Review Taxes",
      to: "/taxes",
      tone: "warn",
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

  const copy = COPY[rec.id] ?? COPY["all-set"];
  const Icon = copy.tone === "warn" ? AlertTriangle : copy.tone === "idea" ? PiggyBank : CheckCircle2;
  const iconClass =
    copy.tone === "warn" ? "text-destructive" : copy.tone === "idea" ? "text-primary" : "text-success";

  return (
    <section
      data-testid="todays-focus"
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
      <p className="min-w-0 flex-1 text-sm leading-snug text-card-foreground">{copy.text}</p>
      {copy.cta && copy.to && (
        <Link
          to={copy.to}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {copy.cta}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
