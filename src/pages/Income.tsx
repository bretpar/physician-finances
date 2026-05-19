import { useMemo } from "react";
import { DollarSign, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2, Clock, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useTransactions, type DbTransaction } from "@/hooks/useTransactions";
import {
  useIncomeEntries, useWeightedIncome, useIncomeDrift, useStaleEntries,
  useMarkReceived, useAutoTransitionEntries, CONFIDENCE_WEIGHTS,
  type IncomeStatus,
} from "@/hooks/useIncome";
import { useCompanies } from "@/contexts/CompanyContext";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { YtdCatchupCard } from "@/components/YtdCatchupCard";
import { parseLocalDate, formatMonthShort } from "@/lib/localDate";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const statusConfig: Record<IncomeStatus, { color: string; bg: string; icon: typeof CheckCircle2 }> = {
  received: { color: "text-green-700 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/30", icon: CheckCircle2 },
  expected: { color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30", icon: Clock },
  projected: { color: "text-muted-foreground", bg: "bg-muted", icon: Clock },
};

export default function Income() {
  const { data: transactions = [] } = useTransactions();
  const { data: entries, isLoading } = useIncomeEntries();
  const { companies } = useCompanies();
  const markReceived = useMarkReceived();
  const autoTransition = useAutoTransitionEntries();

  const drift = useIncomeDrift(entries);
  const staleEntries = useStaleEntries(entries);
  const weighted = useWeightedIncome(entries);

  useEffect(() => {
    autoTransition.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Income transactions from ledger
  const incomeTransactions = useMemo(() =>
    transactions.filter((t) => (t.transaction_type || "expense") === "income"),
    [transactions]
  );

  // Totals by status from income_entries
  const totalsByStatus = useMemo(() => {
    if (!entries) return { received: 0, expected: 0, projected: 0 };
    return entries.reduce(
      (acc, e) => {
        const s = (e.status || "received") as IncomeStatus;
        acc[s] = (acc[s] || 0) + Number(e.paycheck_amount);
        return acc;
      },
      { received: 0, expected: 0, projected: 0 } as Record<IncomeStatus, number>
    );
  }, [entries]);

  const statusCounts = useMemo(() => {
    if (!entries) return { received: 0, expected: 0, projected: 0 };
    return entries.reduce(
      (acc, e) => {
        const s = (e.status || "received") as IncomeStatus;
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      },
      { received: 0, expected: 0, projected: 0 } as Record<IncomeStatus, number>
    );
  }, [entries]);

  // Monthly breakdown from income transactions
  const monthlyBreakdown = useMemo(() => {
    const months: Record<string, { income: number; count: number }> = {};
    const currentYear = new Date().getFullYear();

    // From income_entries (detailed)
    (entries || []).forEach((e) => {
      const d = parseLocalDate(e.income_date);
      if (!d || d.getFullYear() !== currentYear) return;
      const key = formatMonthShort(d);
      if (!months[key]) months[key] = { income: 0, count: 0 };
      months[key].income += Number(e.paycheck_amount);
      months[key].count += 1;
    });

    const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return monthOrder.map((m) => ({
      month: m,
      income: months[m]?.income || 0,
      count: months[m]?.count || 0,
    }));
  }, [entries]);

  const maxMonthlyIncome = Math.max(...monthlyBreakdown.map((m) => m.income), 1);

  // Company breakdown
  const companyBreakdown = useMemo(() => {
    if (!entries) return [];
    const map = new Map<string, { total: number; count: number; type: string }>();
    entries.forEach((e) => {
      const existing = map.get(e.company) || { total: 0, count: 0, type: e.income_type };
      existing.total += Number(e.paycheck_amount);
      existing.count += 1;
      map.set(e.company, existing);
    });
    return [...map.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [entries]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading income analytics…</p></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Income Analytics</h1>
          <p className="text-sm text-muted-foreground">Read-only dashboard — all income is managed in Transactions</p>
        </div>
      </div>

      {/* Drift alert */}
      {drift && (
        <Card className={cn("border-2", drift.isUnder ? "border-destructive/30 bg-red-50/50 dark:bg-red-950/20" : "border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/20")}>
          <CardContent className="flex items-center gap-4 py-4">
            {drift.isUnder ? <TrendingDown className="h-6 w-6 text-destructive shrink-0" /> : <TrendingUp className="h-6 w-6 text-amber-600 shrink-0" />}
            <div>
              <p className={cn("font-semibold", drift.isUnder ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>{drift.message}</p>
              <p className="text-xs text-muted-foreground mt-1">Projected: {fmt(drift.totalProjected)} · Actual: {fmt(drift.totalReceived)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stale entries */}
      {staleEntries.length > 0 && (
        <Card className="border-2 border-amber-400/30 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="font-semibold text-amber-700 dark:text-amber-400">
                {staleEntries.length} income {staleEntries.length === 1 ? "entry" : "entries"} past due date
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {staleEntries.slice(0, 5).map((e) => (
                <Button key={e.id} variant="outline" size="sm" className="gap-1" onClick={() => markReceived.mutate(e.id)}>
                  <CheckCircle2 className="h-3 w-3" /> Mark "{e.name}" as Received ({fmt(Number(e.paycheck_amount))})
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <YtdCatchupCard />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Income (Weighted)</p>
            <p className="text-xl font-bold">{fmt(weighted.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <p className="text-xs text-muted-foreground">Received</p>
            </div>
            <p className="text-xl font-bold">{fmt(totalsByStatus.received)}</p>
            <p className="text-[10px] text-muted-foreground">{statusCounts.received} entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <p className="text-xs text-muted-foreground">Expected</p>
            </div>
            <p className="text-xl font-bold">{fmt(totalsByStatus.expected)}</p>
            <p className="text-[10px] text-muted-foreground">{statusCounts.expected} entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-muted-foreground" />
              <p className="text-xs text-muted-foreground">Projected</p>
            </div>
            <p className="text-xl font-bold">{fmt(totalsByStatus.projected)}</p>
            <p className="text-[10px] text-muted-foreground">{statusCounts.projected} entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Taxes Withheld</p>
            <p className="text-xl font-bold">{fmt(weighted.withheld)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">401k + Deductions</p>
            <p className="text-xl font-bold">{fmt(weighted.retirement + weighted.preTax)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Confidence weighting */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Tax Confidence Weighting:</span>
            <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-green-500" /> Received = 100%</span>
            <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-amber-500" /> Expected = 90%</span>
            <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-muted-foreground" /> Projected = 75%</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Income ({new Date().getFullYear()})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {monthlyBreakdown.map((m) => (
              <div key={m.month} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-8">{m.month}</span>
                <div className="flex-1">
                  <Progress value={(m.income / maxMonthlyIncome) * 100} className="h-4" />
                </div>
                <span className="text-xs font-medium tabular-nums w-24 text-right">
                  {m.income > 0 ? fmt(m.income) : "—"}
                </span>
                {m.count > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{m.count}</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Company Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Income by Source</CardTitle>
          </CardHeader>
          <CardContent>
            {companyBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No income data yet. Add income from the Transactions page.</p>
            ) : (
              <div className="space-y-3">
                {companyBreakdown.map((c) => (
                  <div key={c.name} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.type} · {c.count} entries</p>
                    </div>
                    <span className="text-sm font-bold tabular-nums">{fmt(c.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent income entries (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Income Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {(!entries || entries.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-8">No income entries. Add income from the Transactions page.</p>
          ) : (
            <div className="divide-y divide-border">
              {entries.slice(0, 20).map((e) => {
                const status = (e.status || "received") as IncomeStatus;
                const cfg = statusConfig[status];
                const Icon = cfg.icon;
                return (
                  <div key={e.id} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant="outline" className={cn("gap-1 text-[10px] shrink-0", cfg.color, cfg.bg)}>
                        <Icon className="h-3 w-3" />
                        {status}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.company} · {e.income_type} · {e.income_date}</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-success shrink-0">{fmt(Number(e.paycheck_amount))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
