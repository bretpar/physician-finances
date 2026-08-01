import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import type { AssistantSummary } from "@/hooks/useInsights";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

/**
 * Executive summary at the top of the notification center. DISPLAY ONLY —
 * every number comes from `useInsights` (canonical tax engine + quarter
 * recommendation). 3-4 short sentences, no duplicated paragraphs.
 */
export default function FinancialAssistantSummary({
  assistant,
  isReady,
  onNavigate,
}: {
  assistant: AssistantSummary;
  isReady: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const rec = assistant.recommendation;

  const sentences: string[] = [];
  if (!isReady) {
    sentences.push("Pulling together your latest numbers…");
  } else {
    if (assistant.projectedAnnualIncome > 0) {
      sentences.push(
        `You're projected to earn ${usd(assistant.projectedAnnualIncome)} this year, with about ${usd(
          assistant.annualTaxLiability,
        )} in estimated taxes.`,
      );
    } else {
      sentences.push("We don't have projected income yet, so estimates are incomplete.");
    }
    if (assistant.showQuarterly && assistant.paceHeadline) {
      sentences.push(`${assistant.paceHeadline}.`.replace(/\.\.$/, "."));
    }
    if (rec.id !== "loading") sentences.push(rec.text);
    if (assistant.showQuarterly && assistant.deadlineLabel && assistant.daysUntilDue >= 0) {
      sentences.push(
        `Your ${assistant.quarterLabel || "next"} payment is due ${assistant.deadlineLabel}.`,
      );
    }
  }

  return (
    <section
      data-testid="assistant-summary"
      className="rounded-lg border border-primary/30 bg-primary/5 p-3"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-card-foreground">Financial Assistant</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {sentences.slice(0, 4).join(" ")}
      </p>
      {isReady && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 min-h-11 w-full sm:w-auto"
          onClick={() => {
            onNavigate?.();
            navigate(rec.to);
          }}
        >
          {rec.cta}
        </Button>
      )}
    </section>
  );
}
