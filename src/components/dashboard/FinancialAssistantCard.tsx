import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Info, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useRetirementContributions } from "@/hooks/useRetirementContributions";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useMileageYTD } from "@/hooks/useMileage";
import { selectFinancialAssistantRecommendation } from "@/lib/financialAssistantRecommendation";

/**
 * Plain-English summary of the user's financial situation.
 *
 * DISPLAY ONLY. Every number is passed in from calculations that already exist
 * on the Dashboard (canonical tax engine + quarter recommendation). This card
 * performs no tax math, makes no API calls, and never writes data.
 */
export interface FinancialAssistantCardProps {
  /** Projected (or YTD, depending on the Dashboard's mode) annual income. */
  projectedAnnualIncome: number;
  /** Annual tax liability from the selected withholding profile. */
  annualTaxLiability: number;
  /** Quarter coverage ratio (0-1+) from buildQuarterRecommendation. */
  savingsCoverageRatio: number;
  /** Quarter label, e.g. "Q3". */
  quarterLabel: string;
  /** Short deadline label, e.g. "Sep 15". */
  deadlineLabel: string;
  /** Days until the quarterly deadline (may be negative if passed). */
  daysUntilDue: number;
  /** Whether quarterly estimated payments apply to this user. */
  showQuarterly?: boolean;
}

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

export default function FinancialAssistantCard({
  projectedAnnualIncome,
  annualTaxLiability,
  savingsCoverageRatio,
  quarterLabel,
  deadlineLabel,
  daysUntilDue,
  showQuarterly = true,
}: FinancialAssistantCardProps) {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const { data: taxSettings, isLoading: taxSettingsLoading } = useTaxSettings();
  const { data: retirement, isLoading: retirementLoading } = useRetirementContributions();
  const { data: homeOffice, isLoading: homeOfficeLoading } = useHomeOfficeDeductions(currentYear);
  const { data: ytdMileage = [], isLoading: mileageLoading } = useMileageYTD(currentYear);

  const coveragePct = Math.round(Math.max(0, savingsCoverageRatio) * 100);

  const isReady = !taxSettingsLoading && !retirementLoading && !homeOfficeLoading && !mileageLoading;

  const recommendation = useMemo(
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

  const isAllSet = recommendation.id === "all-set";

  // Never repeat the deadline when the recommendation already states it.
  const showDeadline =
    showQuarterly &&
    daysUntilDue >= 0 &&
    daysUntilDue <= 60 &&
    recommendation.id !== "quarterly-due-soon" &&
    recommendation.id !== "quarterly-overdue";

  // "Sep 15" -> "September 15" for the friendlier all-clear sentence.
  const longDeadlineLabel = (() => {
    const months: Record<string, string> = {
      Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June",
      Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December",
    };
    const [mon, ...rest] = (deadlineLabel || "").split(" ");
    return months[mon] ? [months[mon], ...rest].join(" ") : deadlineLabel;
  })();

  return (
    <Card data-testid="financial-assistant-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-card-foreground">Financial Assistant</p>
        </div>

        <div className="space-y-1.5 text-sm text-muted-foreground">
          {projectedAnnualIncome > 0 && (
            <p>
              You're on track for approximately{" "}
              <span className="font-medium text-foreground tabular-nums">{usd(projectedAnnualIncome)}</span> of income
              this year.
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How projected annual income is calculated"
                      className="ml-1 inline-flex align-middle"
                    >
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-relaxed">
                    Actual income received so far this year plus planned future paychecks from your Income Planner,
                    including W-2, 1099, K-1, personal income, and investment income.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
          )}
          {annualTaxLiability > 0 && (
            <p>
              You're projected to owe approximately{" "}
              <span className="font-medium text-foreground tabular-nums">{usd(annualTaxLiability)}</span> in taxes.
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How estimated annual taxes are calculated"
                      className="ml-1 inline-flex align-middle"
                    >
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-relaxed">
                    Estimated total federal, state, and self-employment taxes based on your projected income, filing
                    status, and current tax settings.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
          )}
          {showQuarterly && annualTaxLiability > 0 && (
            <p>
              You've reserved <span className="font-medium text-foreground tabular-nums">{coveragePct}%</span> of your
              recommended {quarterLabel} tax savings.
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How tax savings progress is calculated"
                      className="ml-1 inline-flex align-middle"
                    >
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-relaxed">
                    Percentage of your recommended quarterly tax savings already set aside, based on your current tax
                    reserve balance and estimated annual taxes.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
          )}
          <p className="text-foreground">{recommendation.text}</p>
          {showDeadline && <p>Your next quarterly payment is due {deadlineLabel}.</p>}
        </div>

        <Button size="sm" className="w-full min-h-11 sm:w-auto" onClick={() => navigate(recommendation.to)}>
          {recommendation.cta}
        </Button>
      </CardContent>
    </Card>
  );
}
