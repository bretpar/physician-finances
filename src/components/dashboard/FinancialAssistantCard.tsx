import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useRetirementContributions } from "@/hooks/useRetirementContributions";
import { useHomeOfficeDeductions } from "@/hooks/useHomeOfficeDeductions";
import { useMileageYTD } from "@/hooks/useMileage";

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

type Recommendation = { text: string; cta: string; to: string };

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
  const { data: taxSettings } = useTaxSettings();
  const { data: retirement } = useRetirementContributions();
  const { data: homeOffice } = useHomeOfficeDeductions(currentYear);
  const { data: ytdMileage = [] } = useMileageYTD(currentYear);

  const coveragePct = Math.round(Math.max(0, savingsCoverageRatio) * 100);

  const recommendation = useMemo<Recommendation>(() => {
    const hasRetirement = (retirement?.length || 0) > 0;
    const hasHsa = !!taxSettings?.hsaEnabled;
    const hasHomeOffice = (homeOffice?.length || 0) > 0;
    const hasMileage = (ytdMileage?.length || 0) > 0;

    // One recommendation only, highest impact first.
    if (showQuarterly && coveragePct < 90 && annualTaxLiability > 0) {
      return {
        text: `Your biggest priority is catching up on your ${quarterLabel} tax savings.`,
        cta: "Review Quarterly Taxes",
        to: "/taxes",
      };
    }
    if (!hasRetirement) {
      return {
        text: "Your biggest opportunity is increasing your retirement contributions.",
        cta: "Review Tax Savings",
        to: "/deductions",
      };
    }
    if (!hasHsa) {
      return {
        text: "Your biggest opportunity is funding an HSA with pre-tax dollars.",
        cta: "Review Tax Savings",
        to: "/deductions",
      };
    }
    if (!hasHomeOffice) {
      return {
        text: "Your biggest opportunity is claiming a home office deduction.",
        cta: "Review Tax Savings",
        to: "/deductions",
      };
    }
    if (!hasMileage) {
      return {
        text: "Your biggest opportunity is logging your business mileage this year.",
        cta: "Review Tax Savings",
        to: "/deductions",
      };
    }
    if (projectedAnnualIncome <= 0) {
      return {
        text: "Add your expected paychecks so we can project your year.",
        cta: "Review Income Planner",
        to: "/projected-income",
      };
    }
    return {
      text: "Your savings strategies look set — keep your income plan up to date.",
      cta: "Review Income Planner",
      to: "/projected-income",
    };
  }, [
    retirement,
    taxSettings?.hsaEnabled,
    homeOffice,
    ytdMileage,
    showQuarterly,
    coveragePct,
    annualTaxLiability,
    quarterLabel,
    projectedAnnualIncome,
  ]);

  const showDeadline = showQuarterly && daysUntilDue >= 0 && daysUntilDue <= 60;

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
            </p>
          )}
          {annualTaxLiability > 0 && (
            <p>
              You're projected to owe approximately{" "}
              <span className="font-medium text-foreground tabular-nums">{usd(annualTaxLiability)}</span> in taxes.
            </p>
          )}
          {showQuarterly && annualTaxLiability > 0 && (
            <p>
              You've reserved <span className="font-medium text-foreground tabular-nums">{coveragePct}%</span> of your
              recommended {quarterLabel} tax savings.
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
