import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxBreakdown } from "@/hooks/useTaxBreakdown";
import { getBuildInfo } from "@/lib/buildInfo";
import { buildRecordSelectionBridge, buildSourceCardReconciliation } from "@/lib/recordSelectionBridge";
import { toast } from "@/hooks/use-toast";
import {
  RECONCILIATION_DATASETS,
  buildReconciliationExport,
  reconciliationFileName,
  type DatasetResult,
  type ReconciliationDatasetName,
} from "@/lib/taxReconciliationExport";

const TAX_YEAR = 2026;

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/** Paginated read-only select; RLS limits rows to the signed-in account. Flags truncation. */
async function fetchDataset(name: ReconciliationDatasetName): Promise<DatasetResult> {
  try {
    const cols = RECONCILIATION_DATASETS[name].join(",");
    const orderCol = (RECONCILIATION_DATASETS[name] as readonly string[]).includes("id") ? "id" : "updated_at";
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await (supabase.from(name as never) as any)
        .select(cols)
        .order(orderCol, { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) return { status: "error", error: error.message };
      const batch = (data ?? []) as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) return { status: "ok", rows, pages: page + 1 };
    }
    return { status: "ok", rows, pages: MAX_PAGES, truncated: true };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

function okRows(d: DatasetResult | undefined): Record<string, unknown>[] | null {
  return d && d.status === "ok" ? d.rows : null;
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
      const datasets = Object.fromEntries(names.map((n, i) => [n, results[i]])) as Record<ReconciliationDatasetName, DatasetResult>;
      const sel = est.recordSelection?.actualPlusPlanned;
      const selActual = est.recordSelection?.actualOnly;
      const entries = okRows(datasets.income_entries);
      const txs = okRows(datasets.transactions);
      const links = okRows(datasets.transaction_links);
      const convs = okRows(datasets.planner_conversions);
      const ids = (rows: any[]) => rows.map((r) => r.id as string);
      const bridge = sel && entries && txs && links && convs
        ? buildRecordSelectionBridge({
            incomeEntries: entries as any[],
            transactions: txs as any[],
            transactionLinks: links as any[],
            plannerConversions: convs as any[],
            selection: {
              businessIncomeTransactionIds: ids(sel.businessIncomeTransactions),
              linkedEnrichmentEntryIds: ids(sel.linkedEnrichmentEntries),
              personalEntryIds: ids(sel.personalEntries),
              projectedPaychecks: sel.projectedPaychecks,
            },
          })
        : null;
      const reconciliation = sel && selActual
        ? {
            actualPlusPlanned: buildSourceCardReconciliation(forecastBreakdown.sources as any[], sel as any, "actualPlusPlanned"),
            actualOnly: buildSourceCardReconciliation(actualBreakdown.sources as any[], selActual as any, "actualOnly"),
            mergeLineage: est.mergeLineageFindings,
            note: "Cards and canonicalRecords cover income records only; YTD catch-up, saved W-2 projections and investment income are separate canonical inputs.",
          }
        : null;
      const payload = buildReconciliationExport({
        taxYear: TAX_YEAR,
        generatedAt: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        build: { ...getBuildInfo() },
        selectedTaxMode: est.taxMode,
        datasets,
        recordSelectionBridge: bridge,
        reconciliation,
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
