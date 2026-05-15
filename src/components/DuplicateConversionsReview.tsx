/**
 * DuplicateConversionsReview
 *
 * Surfaces planner_conversions rows in `duplicate_skipped` state so the user
 * can resolve them without losing the underlying planned occurrence:
 *   • Link to an existing ledger row (income_entries / transactions)
 *   • Convert anyway (force-create a new ledger row)
 *   • Dismiss (mark as user-skipped)
 *
 * The planned stream + occurrence_date are preserved in every path —
 * this screen never deletes the projected_income_streams row, only the
 * duplicate_skipped conversion record once it has been resolved.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Link2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useProjectedStreams, useManualPlannerConvert } from "@/hooks/useProjectedIncome";
import { ledgerForIncomeType } from "@/lib/ledgerRouting";
import { toCanonicalIncomeType } from "@/lib/filingTypes";

interface DuplicateConversionRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  stream_id: string | null;
  bonus_event_id: string | null;
  occurrence_date: string;
  ledger_bucket: "personal" | "business";
  status: string;
  needs_review_reason: string | null;
}

interface CandidateRow {
  id: string;
  date: string;
  label: string;
  amount: number;
  bucket: "personal" | "business";
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function useDuplicateSkippedConversions() {
  return useQuery({
    queryKey: ["planner_conversions", "duplicate_skipped"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planner_conversions")
        .select("id, user_id, organization_id, stream_id, bonus_event_id, occurrence_date, ledger_bucket, status, needs_review_reason")
        .eq("status", "duplicate_skipped")
        .order("occurrence_date", { ascending: false });
      if (error) throw error;
      return (data || []) as DuplicateConversionRow[];
    },
  });
}

async function fetchCandidates(
  bucket: "personal" | "business",
  date: string,
  amount: number,
): Promise<CandidateRow[]> {
  const min = new Date(date); min.setDate(min.getDate() - 5);
  const max = new Date(date); max.setDate(max.getDate() + 5);
  const minStr = min.toISOString().slice(0, 10);
  const maxStr = max.toISOString().slice(0, 10);

  if (bucket === "personal") {
    const { data } = await supabase
      .from("income_entries")
      .select("id, income_date, company, paycheck_amount")
      .gte("income_date", minStr)
      .lte("income_date", maxStr)
      .eq("source_bucket", "personal")
      .eq("is_actual", true);
    return (data || [])
      .filter((r: any) => Math.abs(Number(r.paycheck_amount) - amount) <= Math.max(50, amount * 0.1))
      .map((r: any) => ({ id: r.id, date: r.income_date, label: r.company || "(unnamed)", amount: Number(r.paycheck_amount), bucket }));
  }

  const { data } = await supabase
    .from("transactions")
    .select("id, transaction_date, vendor, amount")
    .gte("transaction_date", minStr)
    .lte("transaction_date", maxStr)
    .eq("status", "active")
    .eq("transaction_type", "income");
  return (data || [])
    .filter((r: any) => Math.abs(Number(r.amount) - amount) <= Math.max(50, amount * 0.1))
    .map((r: any) => ({ id: r.id, date: r.transaction_date, label: r.vendor || "(unnamed)", amount: Number(r.amount), bucket }));
}

export function DuplicateConversionsReview() {
  const { data: dups } = useDuplicateSkippedConversions();
  const { data: streams } = useProjectedStreams();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const manualConvert = useManualPlannerConvert();

  const streamById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof streams>[number]>();
    (streams || []).forEach((s) => m.set(s.id, s));
    return m;
  }, [streams]);

  const linkMutation = useMutation({
    mutationFn: async (input: { conversionId: string; bucket: "personal" | "business"; ledgerId: string }) => {
      const { error } = await supabase
        .from("planner_conversions")
        .update({
          status: "converted",
          income_entry_id: input.bucket === "personal" ? input.ledgerId : null,
          transaction_id: input.bucket === "business" ? input.ledgerId : null,
          needs_review_reason: "Linked to existing ledger row from duplicate review",
        } as any)
        .eq("id", input.conversionId);
      if (error) throw error;
      // Back-link ledger row so it shows as origin=planner.
      if (input.bucket === "personal") {
        await supabase.from("income_entries")
          .update({ origin_type: "planner_converted", origin_planner_conversion_id: input.conversionId } as any)
          .eq("id", input.ledgerId);
      } else {
        await supabase.from("transactions")
          .update({ origin_type: "planner_converted", origin_planner_conversion_id: input.conversionId } as any)
          .eq("id", input.ledgerId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner_conversions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Linked to existing ledger entry");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dismissMutation = useMutation({
    mutationFn: async (conversionId: string) => {
      const { error } = await supabase
        .from("planner_conversions")
        .update({ status: "skipped", needs_review_reason: "Dismissed from duplicate review" } as any)
        .eq("id", conversionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner_conversions"] });
      toast.success("Dismissed — planned occurrence preserved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Force-convert: delete the duplicate_skipped row, then re-run manual convert
  // which creates a fresh planner_conversion + ledger row from the stream's planned fields.
  const forceConvertMutation = useMutation({
    mutationFn: async (row: DuplicateConversionRow) => {
      const stream = row.stream_id ? streamById.get(row.stream_id) : null;
      if (!stream) throw new Error("Planned stream no longer exists");
      const incomeType = toCanonicalIncomeType(stream.company_type || "w2");
      const bucket = ledgerForIncomeType(incomeType);

      // Drop the blocking duplicate_skipped record
      const { error: delErr } = await supabase
        .from("planner_conversions").delete().eq("id", row.id);
      if (delErr) throw delErr;

      await manualConvert.mutateAsync({
        streamId: stream.id,
        bonusEventId: row.bonus_event_id,
        occurrenceDate: row.occurrence_date,
        ledgerBucket: bucket,
        label: stream.company,
        sourceId: stream.source_id,
        incomeType,
        uiIncomeSubtype: stream.ui_income_subtype,
        grossAmount: Number(stream.paycheck_amount) || 0,
        taxesWithheld: Number(stream.taxes_withheld) || 0,
        preTaxDeductions: Number(stream.pre_tax_deductions) || 0,
        retirement401k: Number(stream.retirement_401k) || 0,
        healthcareDeduction: Number(stream.healthcare_deduction) || 0,
        hsaContribution: Number(stream.hsa_contribution) || 0,
        federalWithholding: Number(stream.federal_withholding) || 0,
        stateWithholding: Number(stream.state_withholding) || 0,
        ssWithholding: Number(stream.ss_withholding) || 0,
        medicareWithholding: Number(stream.medicare_withholding) || 0,
        isBonus: Boolean(row.bonus_event_id),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner_conversions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("New ledger row created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!dups || dups.length === 0) return null;

  return (
    <>
      <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {dups.length} planned {dups.length === 1 ? "paycheck" : "paychecks"} flagged as possible duplicate
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Review and link to an existing ledger row, convert anyway, or dismiss — planned fields are kept either way.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Review</Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review duplicate-skipped conversions</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {dups.map((row) => {
              const stream = row.stream_id ? streamById.get(row.stream_id) : null;
              const planned = Number(stream?.paycheck_amount) || 0;
              return (
                <DuplicateRow
                  key={row.id}
                  row={row}
                  streamLabel={stream?.company || "(removed stream)"}
                  plannedAmount={planned}
                  onLink={(ledgerId) => linkMutation.mutate({ conversionId: row.id, bucket: row.ledger_bucket, ledgerId })}
                  onForceConvert={() => forceConvertMutation.mutate(row)}
                  onDismiss={() => dismissMutation.mutate(row.id)}
                  busy={linkMutation.isPending || forceConvertMutation.isPending || dismissMutation.isPending}
                  canForceConvert={Boolean(stream)}
                />
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DuplicateRow({
  row, streamLabel, plannedAmount, onLink, onForceConvert, onDismiss, busy, canForceConvert,
}: {
  row: DuplicateConversionRow;
  streamLabel: string;
  plannedAmount: number;
  onLink: (ledgerId: string) => void;
  onForceConvert: () => void;
  onDismiss: () => void;
  busy: boolean;
  canForceConvert: boolean;
}) {
  const { data: candidates, isLoading } = useQuery({
    queryKey: ["dup_candidates", row.id, row.ledger_bucket, row.occurrence_date, plannedAmount],
    queryFn: () => fetchCandidates(row.ledger_bucket, row.occurrence_date, plannedAmount),
    enabled: plannedAmount > 0,
  });

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{streamLabel}</p>
          <p className="text-xs text-muted-foreground">
            Planned {row.occurrence_date} · {fmt(plannedAmount)} ·{" "}
            <Badge variant="outline" className="ml-1">{row.ledger_bucket}</Badge>
          </p>
          {row.needs_review_reason && (
            <p className="text-xs text-muted-foreground mt-1 italic">{row.needs_review_reason}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Possible matches in ledger:</p>
        {isLoading && <p className="text-xs text-muted-foreground">Searching…</p>}
        {!isLoading && (!candidates || candidates.length === 0) && (
          <p className="text-xs text-muted-foreground">No nearby ledger rows found.</p>
        )}
        {(candidates || []).map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
            <div className="text-xs">
              <span className="font-medium text-foreground">{c.label}</span>{" "}
              <span className="text-muted-foreground">· {c.date} · {fmt(c.amount)}</span>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onLink(c.id)}>
              <Link2 className="h-3.5 w-3.5 mr-1" /> Link
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="secondary" disabled={busy || !canForceConvert} onClick={onForceConvert}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Convert anyway
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
          <X className="h-3.5 w-3.5 mr-1" /> Dismiss
        </Button>
      </div>
    </div>
  );
}
