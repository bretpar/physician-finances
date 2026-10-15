import { ArrowLeft } from "lucide-react";
import type { CatchUpResult } from "@/lib/catchUpRecommendation";

const cents = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Display-only explanation of the quarterly catch-up. Every number comes from
 * the shared CatchUpResult (and its read-only `explanation` inputs); the
 * applied amount is the canonical event's `catchUpApplied`. No tax math here.
 */
export function CatchUpExplanationPanel({
  catchUp,
  applied,
  onBack,
}: {
  catchUp: CatchUpResult;
  applied: number;
  onBack: () => void;
}) {
  const ex = catchUp.explanation;
  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className={`flex justify-between gap-3 text-xs tabular-nums ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
  const perPaycheck = catchUp.quarterlyAdjustmentAmount;
  const adjusted = Math.abs(perPaycheck - applied) >= 0.005;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Tax breakdown
      </button>
      <p className="text-xs font-medium">Quarterly catch-up</p>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Extra savings recommended to help meet your quarterly tax target after accounting for taxes already covered and expected savings from upcoming paychecks. This doesn't necessarily mean you missed a tax payment.
      </p>
      {!ex ? (
        <p className="text-[11px] text-muted-foreground">A detailed breakdown isn't available for this recommendation.</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {ex.quarterLabel} {ex.year} · funding deadline {ex.deadlineLabel}
          </p>
          <div className="space-y-0.5">
            <Row label="Estimated quarterly tax target" value={cents(ex.quarterTarget)} />
            <Row label="Taxes already paid / withheld" value={`−${cents(ex.paidOrWithheld)}`} />
            <Row label="Tax reserves already saved" value={`−${cents(ex.reservesSaved)}`} />
            <Row label="Expected coverage from planned paychecks" value={`−${cents(ex.expectedOrdinaryCoverage)}`} />
            <div className="border-t border-border pt-0.5">
              <Row label="Remaining amount to fund" value={cents(catchUp.uncoveredGap)} strong />
            </div>
            <Row label="Remaining eligible paychecks" value={String(catchUp.remainingOpportunities)} />
            <Row label="Additional savings per paycheck" value={cents(perPaycheck)} strong />
            {adjusted && (
              <Row label="Adjusted to your remaining annual tax" value={cents(applied)} strong />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {cents(catchUp.uncoveredGap)} ÷ {catchUp.remainingOpportunities} = {cents(perPaycheck)} additional catch-up per paycheck.
          </p>
          {adjusted && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              Catch-up is limited so it never exceeds the tax still remaining for the year, so this paycheck carries {cents(applied)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
