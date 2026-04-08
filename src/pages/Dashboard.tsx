import { DollarSign, TrendingUp, TrendingDown, PiggyBank, Receipt, Building2, Briefcase, ShieldCheck } from "lucide-react";
import StatCard from "@/components/StatCard";
import RecentTransactions from "@/components/RecentTransactions";
import TaxWidget from "@/components/TaxWidget";
import { mockTransactions, getSummary } from "@/lib/mockData";

export default function Dashboard() {
  const summary = getSummary(mockTransactions);
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Income" value={fmt(summary.totalIncome)} icon={TrendingUp} variant="success" trend={`W-2: ${fmt(summary.w2Income)} · 1099/K-1: ${fmt(summary.selfEmploymentIncome)}`} />
        <StatCard label="Expenses This Month" value={fmt(summary.totalExpenses)} icon={TrendingDown} variant="destructive" trend={`${mockTransactions.filter(t => t.type === 'expense').length} transactions`} />
        <StatCard label="Net Profit" value={fmt(summary.netProfit)} icon={DollarSign} variant="default" />
        <StatCard label="W-2 Tax Withheld" value={fmt(summary.w2Withheld)} icon={ShieldCheck} variant="success" trend="Already paid via paycheck" />
        <StatCard label="Tax Set-Aside Needed" value={fmt(summary.remainingLiability)} icon={PiggyBank} variant="warning" trend={`Total liability ${fmt(summary.totalTaxLiability)} − W-2 withheld ${fmt(summary.w2Withheld)}`} />
        <StatCard label="Quarterly Estimate" value={fmt(summary.quarterlyEstimate)} icon={Receipt} trend="Due Jun 15, 2026" />
        <StatCard label="WA B&O Tax" value={fmt(summary.bnoTax)} icon={Building2} trend="1.5% of non-W-2 income" />
        <StatCard label="SE Income" value={fmt(summary.selfEmploymentIncome)} icon={Briefcase} trend="1099 + K-1 + Side Business" />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <RecentTransactions transactions={mockTransactions} />
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
