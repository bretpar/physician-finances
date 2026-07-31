import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { OpportunityStatus } from "./OpportunityCard";

/**
 * Display-only "Recommended Next Step" card.
 * Picks a single highest-impact, not-yet-configured category from the items
 * already rendered on the Tax Savings page. No new tax calculations.
 */
export interface RecommendableItem {
  value: string;
  label: string;
  icon: LucideIcon;
  status: OpportunityStatus;
  comingSoon?: boolean;
}

/** Highest → lowest typical impact for a physician household. */
const PRIORITY = ["retirement", "hsa", "home-office", "mileage", "student-loan-interest"];

const COPY: Record<string, { title: string; why: string; cta: string }> = {
  retirement: {
    title: "Retirement Contributions",
    why: "Increasing retirement contributions may reduce your taxable income.",
    cta: "Review Retirement",
  },
  hsa: {
    title: "Maximize Your HSA",
    why: "Contributing to an HSA could reduce your taxable income with pre-tax dollars.",
    cta: "Review HSA",
  },
  "home-office": {
    title: "Home Office Available",
    why: "Based on your business profile, you may qualify for a home office deduction.",
    cta: "Set Up Home Office",
  },
  mileage: {
    title: "Track Business Mileage",
    why: "Business driving you log this year can be deducted at the IRS standard rate.",
    cta: "Add Mileage",
  },
  "student-loan-interest": {
    title: "Student Loan Interest",
    why: "You may still qualify for this deduction on interest you pay this year.",
    cta: "Review",
  },
};

export function RecommendedNextStep({
  items,
  onSelect,
}: {
  items: RecommendableItem[];
  onSelect: (value: string) => void;
}) {
  // Defensive: the page may pass partially-built lists while data loads.
  const known = (items ?? []).filter(
    (i): i is RecommendableItem => Boolean(i && i.value && COPY[i.value] && !i.comingSoon),
  );

  // The same category (e.g. retirement) can appear in both the business and
  // personal sections. If it is configured anywhere, it is not a next step.
  const configuredValues = new Set(
    known.filter((i) => i.status === "configured").map((i) => i.value),
  );

  const candidates = known.filter(
    (i) => i.status === "not_configured" && !configuredValues.has(i.value),
  );
  const pick = PRIORITY.map((v) => candidates.find((i) => i.value === v)).find(Boolean);


  // Nothing recognizable to recommend on (still loading, or no eligible
  // categories for this income profile) — stay silent rather than claim success.
  if (known.length === 0) return null;

  if (!pick) {
    const hasConfigured = configuredValues.size > 0;
    return (

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Recommended Next Step</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="flex items-start gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            {hasConfigured
              ? "You're currently using all available tax-saving strategies."
              : "No additional tax-saving strategies apply to your profile right now."}
          </p>
          <p className="text-xs text-muted-foreground pl-6">
            Review your deductions if your income or situation changes.
          </p>

        </CardContent>
      </Card>
    );
  }

  const copy = COPY[pick.value];
  const Icon = pick.icon ?? Sparkles;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Recommended Next Step</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className="h-5 w-5 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="text-base font-semibold text-card-foreground">{copy.title}</p>
            <p className="text-xs text-muted-foreground">{copy.why}</p>
          </div>
        </div>
        <Button
          onClick={() => onSelect(pick.value)}
          className="w-full sm:w-auto shrink-0 min-h-[44px]"
        >
          {copy.cta}
        </Button>
      </CardContent>
    </Card>
  );
}
