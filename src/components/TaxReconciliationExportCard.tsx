import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxBreakdown } from "@/hooks/useTaxBreakdown";
import { getBuildInfo } from "@/lib/buildInfo";
import { toast } from "@/hooks/use-toast";
import {
  RECONCILIATION_DATASETS,
  buildReconciliationExport,
  reconciliationFileName,
  type DatasetResult,
  type ReconciliationDatasetName,
} from "@/lib/taxReconciliationExport";

const TAX_YEAR = 2026;

async function fetchDataset(name: ReconciliationDatasetName): Promise<DatasetResult> {
  try {
    const cols = RECONCILIATION_DATASETS[name].join(",");
    // Read-only select; RLS limits rows to the signed-in account.
    const { data, error } = await (supabase.from(name as never) as any).select(cols).limit(10000);
    if (error) return { status: "error", error: error.message };
    return { status: "ok", rows: (data ?? []) as Record<string, unknown>[] };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export default function TaxReconciliationExportCard() {
  const [busy, setBusy] = useState(false);
  const est = useTaxEstimate();
  const actualBreakdown = useTaxBreakdown(undefined, "actual");
  const forecastBreakdown = useTaxBreakdown(undefined, "forecast");
  const loading = est.isLoading || actualBreakdown.isLoading || forecastBreakdown.isLoading;

  const handleExport = async () => {
    if (busy || loading) return;
    setBusy(true);
    try {
      const names = Object.keys(RECONCILIATION_DATASETS) as ReconciliationDatasetName[];
      const results = await Promise.all(names.map(fetchDataset));
      const datasets = Object.fromEntries(names.map((n, i) => [n, results[i]]));
      const payload = buildReconciliationExport({
        taxYear: TAX_YEAR,
        generatedAt: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        build: { ...getBuildInfo() },
        selectedTaxMode: est.taxMode,
        datasets,
        calculations: {
          actualOnlyCanonicalInputs: est.canonicalInputs?.actualOnlyTaxInputs ?? null,
          actualPlusPlannedCanonicalInputs: est.canonicalInputs?.includePlannedTaxInputs ?? null,
          actualOnlyEstimate: est.actualEstimate,
          actualOnlyDebug: est.actualDebug,
          currentPaceEstimate: est.currentPaceEstimate,
          currentPaceDebug: est.currentPaceDebug,
          actualPlusPlannedEstimate: est.forecastEstimate,
          actualPlusPlannedDebug: est.forecastDebug,
          taxBreakdownActual: actualBreakdown,
          taxBreakdownActualPlusPlanned: forecastBreakdown,
        },
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reconciliationFileName(TAX_YEAR);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      if (payload.metadata.complete) {
        toast({ title: "Export downloaded" });
      } else {
        toast({
          title: "Export downloaded — incomplete",
          description: `${payload.metadata.unavailable.length} dataset(s) unavailable; see metadata.unavailable.`,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Export tax reconciliation data</CardTitle>
        <CardDescription>
          Read-only. Downloads your account's records and the existing {TAX_YEAR} tax calculation outputs as JSON.
          Nothing is changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleExport} disabled={busy || loading} className="gap-2">
          {busy || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {loading ? "Loading data…" : busy ? "Generating…" : "Export tax reconciliation data"}
        </Button>
      </CardContent>
    </Card>
  );
}
