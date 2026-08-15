import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.max(0, Math.round(n * 100) / 100),
  );

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  recommendedSavings: number;
  actualSaved: number;
  entryTitle: string;
  /**
   * Canonical quarterly coverage status. When the shortfall came from a tax
   * estimate that increased AFTER prior recommendations were satisfied, the copy
   * must never imply the user under-saved.
   */
  coverageStatus?: CoverageStatus;
}

/**
 * Minimal per-transaction tax-savings reminder.
 *
 * Shows ONLY:
 *  - recommended savings for this transaction
 *  - amount already saved on this transaction
 *  - additional amount suggested to stay on pace
 *
 * No annual totals, no quarterly math, no breakdown.
 */
export function SimpleTaxReminderModal({
  open,
  onClose,
  onApply,
  recommendedSavings,
  actualSaved,
  entryTitle,
  coverageStatus,
}: Props) {
  const additional = Math.max(0, recommendedSavings - actualSaved);
  const estimateIncreased = coverageStatus === "estimate_increased";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-primary" />
            {estimateIncreased ? "Estimate increased — catch-up needed" : "Stay on pace with taxes"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {estimateIncreased ? (
              <>
                Your tax estimate went up after adding{" "}
                <strong className="text-foreground">{entryTitle}</strong>. Earlier
                recommendations were correct at the time — set aside about{" "}
                <strong className="text-foreground">{fmt(additional)}</strong> here to catch up.
              </>
            ) : (
              <>
                To stay on pace with taxes for{" "}
                <strong className="text-foreground">{entryTitle}</strong>, save about{" "}
                <strong className="text-foreground">{fmt(additional)}</strong> more.
              </>
            )}
          </p>


          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recommended for this entry</span>
              <span className="font-medium">{fmt(recommendedSavings)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Already saved</span>
              <span className="font-medium">{fmt(actualSaved)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5">
              <span className="font-medium">Suggested additional</span>
              <span className="font-semibold text-primary">{fmt(additional)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {additional > 0 && (
            <Button onClick={onApply} className="w-full sm:w-auto">
              Add {fmt(additional)} to reserve
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
