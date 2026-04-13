import { TrendingUp, TrendingDown, DollarSign, PiggyBank, CheckCircle2, AlertTriangle, Wallet, Briefcase } from "lucide-react";
import { useNavigate } from "react-router-dom";
import StatCard from "@/components/StatCard";
import RecentTransactions from "@/components/RecentTransactions";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: savings = [] } = useTaxSavings();
  const { estimate } = useTaxEstimate();
  const summary = useDashboardSummary(transactions, rates, incomeEntries, personalEntries);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  if (txLoading || ratesLoading || incLoading || piLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const totalSetAside = savings.reduce((s, e) => s + Number(e.amount), 0);
  const estOwed = estimate?.totalTaxLiability ?? 0;
  const withheld = estimate?.taxesAlreadyWithheld ?? 0;
  const remaining = Math.max(0, estOwed - withheld);
  const gap = totalSetAside - remaining;
  const ok = gap >= 0;
  const progressPct = remaining > 0 ? Math.min(100, (totalSetAside / remaining) * 100) : 100;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Key income breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Business Net Income" value={fmt(summary.businessNetIncome)} icon={Briefcase} variant="default" />
        <StatCard label="Personal Income" value={fmt(summary.personalIncome)} icon={Wallet} variant="success" />
        <StatCard label="Business Expenses" value={fmt(summary.businessExpenses)} icon={TrendingDown} variant="destructive" />
        <StatCard label="Tax Already Withheld" value={fmt(summary.totalWithheld)} icon={PiggyBank} variant="warning" />
      </div>

      {/* Tax overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-muted-foreground">AGI Estimate</p>
            <p className="text-lg font-bold tabular-nums">{fmt(estimate?.agi ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-muted-foreground">Estimated Tax Owed</p>
            <p className="text-lg font-bold tabular-nums text-destructive">{fmt(estOwed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-muted-foreground">Tax Already Withheld</p>
            <p className="text-lg font-bold tabular-nums text-emerald-600">{fmt(withheld)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-muted-foreground">Estimated Tax Gap</p>
            <p className={cn("text-lg font-bold tabular-nums", remaining > 0 ? "text-amber-600" : "text-emerald-600")}>{fmt(remaining)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tax status */}
      <Card className={cn("border-2", ok ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/10" : "border-amber-400/30 bg-amber-50/30 dark:bg-amber-950/10")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            {ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
            Tax Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Remaining Tax</p>
              <p className="font-semibold">{fmt(remaining)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Saved So Far</p>
              <p className="font-semibold">{fmt(totalSetAside)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Difference</p>
              <p className={cn("font-semibold", ok ? "text-green-600" : "text-amber-600")}>{fmt(gap)}</p>
            </div>
          </div>
          <Progress value={progressPct} className="h-2" />
          <p className={cn("text-sm", ok ? "text-green-600" : "text-amber-600")}>
            {ok ? "You're on track — enough saved for taxes." : `Save ${fmt(Math.abs(gap))} more to be on track.`}
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/taxes")}>
            View Tax Details →
          </Button>
        </CardContent>
      </Card>

      {/* Recent transactions */}
      <RecentTransactions transactions={transactions || []} />
    </div>
  );
}
