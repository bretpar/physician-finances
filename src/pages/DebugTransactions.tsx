/**
 * Internal debug view: shows every transaction the current user has and
 * whether it would be included in (a) the Business Ledger and (b) the Tax
 * Overview. Use this when the two screens disagree to find the offending row.
 *
 * Inclusion rules mirrored here:
 *   Business Ledger : status='active' AND excluded_from_reports=false AND source_id matches selected company
 *   Tax Overview    : status='active' (income transactions feed business gross;
 *                     expense transactions feed deductions; income_entries
 *                     enrich withholding ONLY when linked to a live tx)
 *
 * Not linked into the main nav — reach via /debug/transactions.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface DebugTx {
  id: string;
  transaction_date: string;
  vendor: string;
  amount: number;
  transaction_type: string;
  source_id: string | null;
  source_type: string | null;
  status: string;
  excluded_from_reports: boolean;
  linked_group_id: string | null;
  plaid_transaction_ref: string | null;
  entity: string;
  company_type: string;
  created_at: string;
  updated_at: string;
}

interface DebugIncomeEntry {
  id: string;
  company: string;
  income_date: string;
  paycheck_amount: number;
  linked_transaction_id: string | null;
}

export default function DebugTransactions() {
  const { data, isLoading } = useQuery({
    queryKey: ["debug_transactions"],
    queryFn: async () => {
      const [{ data: txs }, { data: ies }] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, transaction_date, vendor, amount, transaction_type, source_id, source_type, status, excluded_from_reports, linked_group_id, plaid_transaction_ref, entity, company_type, created_at, updated_at")
          .order("transaction_date", { ascending: false })
          .limit(500),
        supabase
          .from("income_entries")
          .select("id, company, income_date, paycheck_amount, linked_transaction_id")
          .limit(500),
      ]);
      return {
        txs: (txs || []) as DebugTx[],
        ies: (ies || []) as DebugIncomeEntry[],
      };
    },
  });

  const stats = useMemo(() => {
    if (!data) return null;
    const liveTxIds = new Set(data.txs.map((t) => t.id));
    const orphans = data.ies.filter((e) => e.linked_transaction_id && !liveTxIds.has(e.linked_transaction_id));
    return {
      totalTx: data.txs.length,
      activeTx: data.txs.filter((t) => t.status === "active").length,
      hiddenTx: data.txs.filter((t) => t.excluded_from_reports).length,
      mergedTx: data.txs.filter((t) => t.status === "merged" || t.status === "duplicate" || t.status === "archived").length,
      incomeEntries: data.ies.length,
      orphans: orphans.length,
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const liveTxIds = new Set((data?.txs || []).map((t) => t.id));

  return (
    <div className="p-4 space-y-4 max-w-screen-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Transactions debug view</CardTitle>
          <CardDescription>
            Internal diagnostic. Every row shows whether it appears in the Business Ledger and whether
            it contributes to the Tax Overview.
          </CardDescription>
        </CardHeader>
        {stats && (
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
            <Stat label="Tx total" value={stats.totalTx} />
            <Stat label="Active" value={stats.activeTx} />
            <Stat label="Excluded" value={stats.hiddenTx} />
            <Stat label="Merged/dup/arch" value={stats.mergedTx} />
            <Stat label="Income entries" value={stats.incomeEntries} />
            <Stat label="Orphan IEs" value={stats.orphans} highlight={stats.orphans > 0} />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Transactions ({data?.txs.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vendor / Entity</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hidden</TableHead>
                <TableHead>Linked</TableHead>
                <TableHead>In Ledger</TableHead>
                <TableHead>In Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.txs || []).map((t) => {
                const inLedger = t.status === "active" && !t.excluded_from_reports && !!t.source_id;
                const inTax = t.status === "active";
                return (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-xs">{t.transaction_date}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium truncate max-w-[180px]">{t.vendor}</div>
                      <div className="text-muted-foreground truncate max-w-[180px]">{t.entity}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      ${Math.abs(Number(t.amount)).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs">{t.transaction_type}</TableCell>
                    <TableCell className="text-xs">
                      <div>{t.source_type}</div>
                      <div className="text-muted-foreground truncate max-w-[120px]">{t.source_id ?? "—"}</div>
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell>{t.excluded_from_reports ? <Badge variant="outline">excl</Badge> : "—"}</TableCell>
                    <TableCell className="text-xs">{t.linked_group_id ? "yes" : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={inLedger ? "default" : "secondary"}>{inLedger ? "yes" : "no"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={inTax ? "default" : "secondary"}>{inTax ? "yes" : "no"}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Income entries ({data?.ies.length ?? 0})</CardTitle>
          <CardDescription>
            "Linked OK" = the income_entry's linked_transaction_id points to a live transaction. Orphans
            are excluded from Tax Overview totals automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Paycheck</TableHead>
                <TableHead>Linked tx ID</TableHead>
                <TableHead>Linked OK</TableHead>
                <TableHead>Counts in Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.ies || []).map((e) => {
                const linked = e.linked_transaction_id ? liveTxIds.has(e.linked_transaction_id) : false;
                const unlinked = !e.linked_transaction_id;
                const inTax = unlinked || linked; // standalone IEs still count; orphans don't
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">{e.income_date}</TableCell>
                    <TableCell className="text-xs">{e.company || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      ${Number(e.paycheck_amount).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]">
                      {e.linked_transaction_id ?? "—"}
                    </TableCell>
                    <TableCell>
                      {unlinked ? <Badge variant="outline">standalone</Badge>
                        : linked ? <Badge>yes</Badge>
                        : <Badge variant="destructive">orphan</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={inTax ? "default" : "secondary"}>{inTax ? "yes" : "no"}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-warning bg-warning/10" : "bg-muted/30"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: "default" | "secondary" | "destructive" | "outline" =
    status === "active" ? "default"
    : status === "merged" ? "secondary"
    : status === "duplicate" ? "destructive"
    : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}
