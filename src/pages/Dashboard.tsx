import { DollarSign, TrendingUp, TrendingDown, PiggyBank, Receipt, Building2 } from "lucide-react";
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Income This Month" value={fmt(summary.totalIncome)} icon={TrendingUp} variant="success" trend="3 income streams" />
        <StatCard label="Expenses This Month" value={fmt(summary.totalExpenses)} icon={TrendingDown} variant="destructive" trend={`${mockTransactions.filter(t => t.type === 'expense').length} transactions`} />
        <StatCard label="Net Profit" value={fmt(summary.netProfit)} icon={DollarSign} variant="default" />
        <StatCard label="Tax Set-Aside" value={fmt(summary.estimatedTax + summary.seTax + summary.bnoTax)} icon={PiggyBank} variant="warning" trend="Fed + SE + B&O" />
        <StatCard label="Quarterly Estimate" value={fmt(summary.quarterlyEstimate)} icon={Receipt} trend="Due Jun 15, 2025" />
        <StatCard label="WA B&O Tax" value={fmt(summary.bnoTax)} icon={Building2} trend="1.5% of gross" />
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
          />
        </div>
      </div>
    </div>
  );
}
