import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  repairPlannerConvertedWithholding,
  type RepairRunResult,
} from "@/lib/plannerConversionRepair";

/**
 * Dev/maintenance surface for the planner-conversion withholding fix.
 * Scan is read-only; applying only touches rows whose stored withholding still
 * equals the parent stream default and that the user never reviewed/edited.
 */
export function PlannerWithholdingRepairCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"scan" | "apply" | null>(null);
  const [result, setResult] = useState<RepairRunResult | null>(null);

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "scan" : "apply");
    try {
      const r = await repairPlannerConvertedWithholding({ dryRun });
      setResult(r);
      if (!dryRun) {
        toast.success(`${r.repaired} converted paycheck(s) repaired`);
        qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
        qc.invalidateQueries({ queryKey: ["income_entries"] });
      } else {
        toast.info(`${r.repaired} of ${r.scanned} converted paycheck(s) need repair`);
      }
    } catch (e: any) {
      toast.error(e?.message || "Repair failed");
    } finally {
      setBusy(null);
    }
  };

  const repairs = (result?.decisions || []).filter((d) => d.decision === "repair");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          Planner-converted withholding
        </CardTitle>
        <CardDescription>
          Older converted paychecks may have stored the recurring stream's withholding instead of
          the individual paycheck's. Scan first — nothing changes until you apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(true)}>
            {busy === "scan" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Scan
          </Button>
          <Button
            size="sm"
            disabled={!!busy || repairs.length === 0}
            onClick={() => run(false)}
          >
            {busy === "apply" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply {repairs.length > 0 ? `(${repairs.length})` : ""}
          </Button>
        </div>
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1 max-h-48 overflow-auto">
            <div className="text-muted-foreground">
              Scanned {result.scanned} · needs repair {repairs.length} · skipped {result.skipped}
              {result.errors > 0 ? ` · errors ${result.errors}` : ""}
            </div>
            {repairs.slice(0, 20).map((d) => (
              <div key={d.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {d.label} · {d.date}
                </span>
                <span className="tabular-nums">
                  ${d.from?.federal.toFixed(2)} → ${d.to?.federal.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
