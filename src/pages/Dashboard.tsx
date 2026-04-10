import { DollarSign, TrendingUp, TrendingDown, PiggyBank, Receipt, Building2, Briefcase, ShieldCheck, CheckCircle2, AlertTriangle, Clock, CalendarCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import StatCard from "@/components/StatCard";
import RecentTransactions from "@/components/RecentTransactions";
import TaxWidget from "@/components/TaxWidget";
import { useTransactions } from "@/hooks/useTransactions";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTaxPayments } from "@/hooks/useTaxPayments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: savings = [] } = useTaxSavings();
  const { estimate } = useTaxEstimate();
  const { data: taxPayments = [] } = useTaxPayments();
  const summary = useDashboardSummary(transactions, rates, incomeEntries);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  if (txLoading || ratesLoading || incLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Income" value={fmt(summary.totalIncome)} icon={TrendingUp} variant="success" trend={`W-2: ${fmt(summary.w2Income)} · 1099/K-1: ${fmt(summary.selfEmploymentIncome)}`} />
        <StatCard label="Expenses This Month" value={fmt(summary.totalExpenses)} icon={TrendingDown} variant="destructive" trend={`${(transactions || []).filter(t => t.amount < 0).length} transactions`} />
        <StatCard label="Net Profit" value={fmt(summary.netProfit)} icon={DollarSign} variant="default" />
        <StatCard label="W-2 Tax Withheld" value={fmt(summary.w2Withheld)} icon={ShieldCheck} variant="success" trend="Already paid via paycheck" />
        <StatCard label="Tax Set-Aside Needed" value={fmt(summary.remainingLiability)} icon={PiggyBank} variant="warning" trend={`Total liability ${fmt(summary.totalTaxLiability)} − W-2 withheld ${fmt(summary.w2Withheld)}`} />
        <StatCard label="Quarterly Estimate" value={fmt(summary.quarterlyEstimate)} icon={Receipt} trend="Due next quarter" />
        <StatCard label="WA B&O Tax" value={fmt(summary.bnoTax)} icon={Building2} trend={`${rates?.bnoRate ?? 1.5}% of non-W-2 income`} />
        <StatCard label="SE Income" value={fmt(summary.selfEmploymentIncome)} icon={Briefcase} trend="1099 + K-1 + Side Business" />
      </div>

      {/* Tax Reserve Status Card */}
      {(() => {
        const totalSetAside = savings.reduce((s, e) => s + Number(e.amount), 0);
        const estOwed = estimate?.totalTaxLiability ?? 0;
        const withheld = estimate?.taxesAlreadyWithheld ?? 0;
        const remaining = Math.max(0, estOwed - withheld);
        const gap = totalSetAside - remaining;
        const ok = gap >= 0;
        return (
          <Card className={cn("border-2", ok ? "border-green-500/30" : "border-destructive/30")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                {ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
                Tax Reserve Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Est. Owed</p>
                  <p className="font-semibold">{fmt(remaining)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Set Aside</p>
                  <p className="font-semibold">{fmt(totalSetAside)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Difference</p>
                  <p className={cn("font-semibold", ok ? "text-green-600" : "text-destructive")}>{fmt(gap)}</p>
                </div>
              </div>
              <p className={cn("text-sm font-medium", ok ? "text-green-600" : "text-destructive")}>
                {ok ? "On track — enough saved for taxes" : `Under-saving by ${fmt(Math.abs(gap))}`}
              </p>
              <Button variant="outline" size="sm" onClick={() => navigate("/tax-reserve")}>View Tax Reserve →</Button>
            </CardContent>
          </Card>
        );
      })()}

      {/* Main content */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <RecentTransactions transactions={transactions || []} />
        </div>
        <div>
          <TaxWidget
            estimatedTax={summary.estimatedTax}
            seTax={summary.seTax}
            quarterlyEstimate={summary.quarterlyEstimate}
            bnoTax={summary.bnoTax}
            netProfit={summary.netProfit}
            w2Withheld={summary.w2Withheld}
            totalTaxLiability={summary.totalTaxLiability}
            remainingLiability={summary.remainingLiability}
          />
        </div>
      </div>
    </div>
  );
}
